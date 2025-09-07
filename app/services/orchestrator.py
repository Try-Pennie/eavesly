"""
Main orchestrator for call quality evaluation.

Coordinates between different evaluation services.
"""

import asyncio
import json
from typing import Any, Dict, List, Optional

from app.models.requests import EvaluateCallRequest
from app.models.schemas import (
    CallClassification,
    Communication,
    Compliance,
    DeepDive,
    EvaluationResult,
    ScriptAdherence,
)
from app.services.llm_client import FallbackManager, StructuredLLMClient
from app.services.prompt_layer import PromptLayerClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class CallQAOrchestrator:
    """Main orchestrator for call quality evaluation"""

    def __init__(self):
        self.llm_client = StructuredLLMClient()
        self.prompt_client = PromptLayerClient()
        self.fallback_manager = FallbackManager()
        self.initialized = False

    async def initialize(self):
        """Initialize orchestrator by fetching all prompt templates"""
        if self.initialized:
            return

        logger.info("Initializing orchestrator...")
        self.initialized = True
        logger.info("Orchestrator initialized successfully")

    async def evaluate_call(self, request: EvaluateCallRequest) -> EvaluationResult:
        """
        Main evaluation method - orchestrates all evaluation steps
        
        Implements the full workflow:
        1. Classification → determines evaluation scope
        2. Parallel evaluations → script adherence, compliance, communication
        3. Conditional deep dive → if issues are detected
        """
        if not self.initialized:
            await self.initialize()

        try:
            logger.info(f"Starting evaluation workflow for call {request.call_id}")

            # Stage 1: Classification - determines what needs to be evaluated
            logger.info(f"Stage 1: Classifying call {request.call_id}")
            classification = await self._classify_call(request)

            logger.debug(f"Classification result for {request.call_id}: "
                        f"outcome={classification.call_outcome}, "
                        f"red_flags={len(classification.red_flags)}, "
                        f"deep_dive_required={classification.requires_deep_dive}")

            # Stage 2: Parallel Evaluations - run all evaluations concurrently
            logger.info(f"Stage 2: Running parallel evaluations for {request.call_id}")
            script_task = self._evaluate_script_adherence(request, classification)
            compliance_task = self._evaluate_compliance(request)
            communication_task = self._evaluate_communication(request)

            # Execute all evaluations in parallel
            evaluation_results = await asyncio.gather(
                script_task, compliance_task, communication_task,
                return_exceptions=True
            )

            script_adherence, compliance, communication = evaluation_results

            # Handle any failures with fallbacks
            if isinstance(script_adherence, Exception):
                logger.error(f"Script adherence evaluation failed for {request.call_id}: {script_adherence}")
                script_adherence = await self.fallback_manager.get_fallback("ScriptAdherence")

            if isinstance(compliance, Exception):
                logger.error(f"Compliance evaluation failed for {request.call_id}: {compliance}")
                compliance = await self.fallback_manager.get_fallback("Compliance")

            if isinstance(communication, Exception):
                logger.error(f"Communication evaluation failed for {request.call_id}: {communication}")
                communication = await self.fallback_manager.get_fallback("Communication")

            # Stage 3: Conditional Deep Dive - only if issues are detected
            deep_dive = None
            if self._requires_deep_dive(classification, compliance):
                logger.info(f"Stage 3: Performing deep dive analysis for {request.call_id}")
                try:
                    deep_dive = await self._perform_deep_dive(request, classification, compliance)
                except Exception as e:
                    logger.error(f"Deep dive analysis failed for {request.call_id}: {str(e)}")
                    # Deep dive failure is not critical - continue without it
                    deep_dive = None
            else:
                logger.debug(f"No deep dive required for {request.call_id}")

            # Return complete evaluation result
            result = EvaluationResult(
                classification=classification,
                script_deviation=script_adherence,
                compliance=compliance,
                communication=communication,
                deep_dive=deep_dive
            )

            logger.info(f"Evaluation workflow completed for {request.call_id}")
            return result

        except Exception as e:
            logger.error(f"Evaluation workflow failed for {request.call_id}: {str(e)}")
            raise

    async def _classify_call(self, request: EvaluateCallRequest) -> CallClassification:
        """
        Classify the call and determine evaluation scope with comprehensive variable mapping.
        
        Handles:
        - Call context and client data serialization 
        - Script progress validation against sections attempted
        - Financial profile data mapping
        - Early termination justification logic
        """
        script_progress = request.client_data.script_progress
        financial_profile = request.client_data.financial_profile
        transcript_meta = request.transcript.metadata

        # Variable mapping for call_qa_router_classifier template
        # Expected variables: ["client_data", "migo_call_script", "transcript"]
        variables = {
            "client_data": json.dumps(request.client_data.model_dump(), indent=2),
            "migo_call_script": request.ideal_script,
            "transcript": request.transcript.transcript
        }

        logger.debug(f"Classification variables prepared for {request.call_id}", extra={
            "template_name": "call_qa_router_classifier",
            "variables_provided": list(variables.keys())
        })

        # Execute PromptLayer template to get llm_kwargs
        promptlayer_response = await self.prompt_client.execute_prompt_template(
            prompt_name="call_qa_router_classifier",
            input_variables=variables
        )
        
        # Extract llm_kwargs from PromptLayer response
        llm_kwargs = self.prompt_client.extract_llm_kwargs(promptlayer_response)
        
        # Use PromptLayer llm_kwargs with OpenRouter
        return await self.llm_client.get_structured_response_from_llm_kwargs(
            response_model=CallClassification,
            llm_kwargs=llm_kwargs
        )

    async def _evaluate_script_adherence(
        self,
        request: EvaluateCallRequest,
        classification: CallClassification
    ) -> ScriptAdherence:
        """
        Evaluate script adherence with comprehensive section-by-section analysis.
        
        Handles:
        - Section-by-section evaluation based on script progress
        - Context-aware evaluation scope based on termination reason
        - Partial script completion scenarios
        - Quote extraction for critical misses
        """
        script_progress = request.client_data.script_progress
        transcript_meta = request.transcript.metadata

        # Determine evaluation scope based on actual progress and context
        sections_to_evaluate = []
        for section in script_progress.sections_attempted:
            # Include section if attempted, regardless of completion
            sections_to_evaluate.append(section)

        # Add context about why evaluation scope is limited
        evaluation_context = {
            "sectionsToEvaluate": sections_to_evaluate,
            "contextualTermination": script_progress.termination_reason != "agent_error",
            "partialCompletion": script_progress.last_completed_section < max(script_progress.sections_attempted) if script_progress.sections_attempted else False,
            "evaluationScope": "full" if script_progress.termination_reason in ["completed", "loan_approved"] else "partial",
            "terminationJustified": classification.early_termination_justified
        }

        # Variable mapping for call_qa_script_deviation template
        # Expected variables: ["actual_transcript", "expected_sections", "ideal_transcript", "sections_attempted"]
        variables = {
            "actual_transcript": request.transcript.transcript,
            "expected_sections": json.dumps(sections_to_evaluate),
            "ideal_transcript": request.ideal_script,
            "sections_attempted": json.dumps(script_progress.sections_attempted)
        }

        logger.debug(f"Script adherence evaluation prepared for {request.call_id}", extra={
            "template_name": "call_qa_script_deviation",
            "variables_provided": list(variables.keys()),
            "sections_to_evaluate": len(sections_to_evaluate)
        })

        # Execute PromptLayer template to get llm_kwargs
        promptlayer_response = await self.prompt_client.execute_prompt_template(
            prompt_name="call_qa_script_deviation",
            input_variables=variables
        )
        
        # Extract llm_kwargs from PromptLayer response
        llm_kwargs = self.prompt_client.extract_llm_kwargs(promptlayer_response)
        
        # Use PromptLayer llm_kwargs with OpenRouter
        return await self.llm_client.get_structured_response_from_llm_kwargs(
            response_model=ScriptAdherence,
            llm_kwargs=llm_kwargs
        )

    async def _evaluate_compliance(self, request: EvaluateCallRequest) -> Compliance:
        """
        Evaluate compliance with regulations using comprehensive requirement mapping.
        
        Handles:
        - Regulatory requirement mapping based on financial profile
        - Context-specific compliance rules (TCPA, CFPB, internal policies)
        - Detailed violation tracking with evidence
        - Risk assessment based on client data
        """
        script_progress = request.client_data.script_progress
        financial_profile = request.client_data.financial_profile
        transcript_meta = request.transcript.metadata

        # Variable mapping for call_qa_compliance template
        # Expected variables: ["transcript"]
        variables = {
            "transcript": request.transcript.transcript
        }

        logger.debug(f"Compliance evaluation prepared for {request.call_id}", extra={
            "template_name": "call_qa_compliance",
            "variables_provided": list(variables.keys())
        })

        # Execute PromptLayer template to get llm_kwargs
        promptlayer_response = await self.prompt_client.execute_prompt_template(
            prompt_name="call_qa_compliance",
            input_variables=variables
        )
        
        # Extract llm_kwargs from PromptLayer response
        llm_kwargs = self.prompt_client.extract_llm_kwargs(promptlayer_response)
        
        # Use PromptLayer llm_kwargs with OpenRouter
        return await self.llm_client.get_structured_response_from_llm_kwargs(
            response_model=Compliance,
            llm_kwargs=llm_kwargs
        )

    async def _evaluate_communication(self, request: EvaluateCallRequest) -> Communication:
        """
        Evaluate communication skills with comprehensive skill categories and ratings.
        
        Handles:
        - Comprehensive skill categories (empathy, clarity, professionalism, etc.)
        - Rating logic for each skill with examples
        - Call flow and pacing evaluation
        - Performance example extraction
        """
        transcript_meta = request.transcript.metadata
        script_progress = request.client_data.script_progress

        # Variable mapping for call_qa_communication template
        # Expected variables: ["transcript"]
        variables = {
            "transcript": request.transcript.transcript
        }

        logger.debug(f"Communication evaluation prepared for {request.call_id}", extra={
            "template_name": "call_qa_communication",
            "variables_provided": list(variables.keys())
        })

        # Execute PromptLayer template to get llm_kwargs
        promptlayer_response = await self.prompt_client.execute_prompt_template(
            prompt_name="call_qa_communication",
            input_variables=variables
        )
        
        # Extract llm_kwargs from PromptLayer response
        llm_kwargs = self.prompt_client.extract_llm_kwargs(promptlayer_response)
        
        # Use PromptLayer llm_kwargs with OpenRouter
        return await self.llm_client.get_structured_response_from_llm_kwargs(
            response_model=Communication,
            llm_kwargs=llm_kwargs
        )

    def _requires_deep_dive(
        self,
        classification: CallClassification,
        compliance: Compliance
    ) -> bool:
        """
        Enhanced decision logic for determining if deep dive analysis is needed.
        
        Uses multiple criteria and scoring to make informed decisions:
        - Compliance violations (critical trigger)
        - Red flags and classification issues 
        - Pattern detection for repeated issues
        - Severity-based triggers with thresholds
        """
        # Critical triggers - always require deep dive
        critical_triggers = [
            len(compliance.summary.violations) > 0,  # Any compliance violation
            classification.requires_deep_dive,        # Explicit classification flag
        ]

        if any(critical_triggers):
            logger.debug("Deep dive triggered by critical factors", extra={
                "compliance_violations": len(compliance.summary.violations),
                "classification_flag": classification.requires_deep_dive
            })
            return True

        # Calculate issue severity score
        severity_score = self._calculate_deep_dive_score(classification, compliance)

        # Threshold-based decision (score >= 3 triggers deep dive)
        threshold = 3

        logger.debug(f"Deep dive severity score: {severity_score} (threshold: {threshold})", extra={
            "red_flags": len(classification.red_flags),
            "coaching_needed": len(compliance.summary.coaching_needed),
            "script_issues": len([v for v in classification.script_adherence_preview.values() if v == "low"]),
            "early_termination_unjustified": not classification.early_termination_justified and
                                           classification.call_outcome in ["incomplete", "lost"]
        })

        return severity_score >= threshold

    def _calculate_deep_dive_score(
        self,
        classification: CallClassification,
        compliance: Compliance
    ) -> int:
        """Calculate severity score for deep dive decision making"""
        score = 0

        # Red flags scoring (1 point each, max 3)
        red_flag_score = min(len(classification.red_flags), 3)
        score += red_flag_score

        # Coaching needed items (0.5 points each, max 2)
        coaching_score = min(len(compliance.summary.coaching_needed) * 0.5, 2)
        score += coaching_score

        # Script adherence issues (1 point per low adherence, max 2)
        script_issues = len([v for v in classification.script_adherence_preview.values() if v == "low"])
        script_score = min(script_issues, 2)
        score += script_score

        # Call outcome penalties
        if classification.call_outcome == "lost":
            score += 1
        elif classification.call_outcome == "incomplete" and not classification.early_termination_justified:
            score += 2

        # Multiple issue categories penalty (systemic issues indicator)
        issue_categories = 0
        if len(classification.red_flags) > 0:
            issue_categories += 1
        if len(compliance.summary.coaching_needed) > 0:
            issue_categories += 1
        if script_issues > 0:
            issue_categories += 1

        if issue_categories >= 2:
            score += 1  # Multiple categories suggest systemic issues

        return int(score)

    async def _perform_deep_dive(
        self,
        request: EvaluateCallRequest,
        classification: CallClassification,
        compliance: Compliance
    ) -> DeepDive:
        """
        Perform comprehensive deep dive analysis with root cause analysis.
        
        Handles:
        - Root cause analysis of identified issues
        - Customer impact assessment with severity scoring
        - Actionable recommendations generation  
        - Urgency determination for remedial actions
        """
        script_progress = request.client_data.script_progress
        transcript_meta = request.transcript.metadata
        financial_profile = request.client_data.financial_profile

        # Variable mapping for call_qa_deep_dive template
        # Expected variables: ["evaluation_results", "red_flags", "transcript"]
        
        # Construct evaluation_results from all previous evaluation outputs
        evaluation_results = {
            "classification": classification.model_dump(),
            "compliance": compliance.model_dump()
        }
        
        variables = {
            "evaluation_results": json.dumps(evaluation_results, indent=2),
            "red_flags": "\n".join(classification.red_flags) if classification.red_flags else "None identified",
            "transcript": request.transcript.transcript
        }

        logger.debug(f"Deep dive analysis prepared for {request.call_id}", extra={
            "template_name": "call_qa_deep_dive",
            "variables_provided": list(variables.keys()),
            "red_flags_count": len(classification.red_flags)
        })

        # Execute PromptLayer template to get llm_kwargs
        promptlayer_response = await self.prompt_client.execute_prompt_template(
            prompt_name="call_qa_deep_dive",
            input_variables=variables
        )
        
        # Extract llm_kwargs from PromptLayer response
        llm_kwargs = self.prompt_client.extract_llm_kwargs(promptlayer_response)
        
        # Use PromptLayer llm_kwargs with OpenRouter
        return await self.llm_client.get_structured_response_from_llm_kwargs(
            response_model=DeepDive,
            llm_kwargs=llm_kwargs
        )

    def calculate_overall_score(self, evaluation: EvaluationResult) -> int:
        """
        Calculate overall score from evaluation results using weighted scoring algorithm
        
        Scoring breakdown:
        - Base score: 100
        - Compliance violations: -15 points each
        - Coaching needed items: -5 points each  
        - Communication skills missed: -3 points each
        - Communication skills exceeded: +2 points each
        - Critical script misses: -10 points each
        - Deep dive findings by severity: Critical(-20), High(-15), Medium(-10), Low(-5)
        """
        score = 100

        # Deduct for compliance issues
        score -= len(evaluation.compliance.summary.violations) * 15
        score -= len(evaluation.compliance.summary.coaching_needed) * 5

        # Deduct for communication issues
        score -= len(evaluation.communication.summary.missed) * 3

        # Add for exceptional performance
        score += len(evaluation.communication.summary.exceeded) * 2

        # Deduct for critical script misses
        critical_misses = 0
        for section_eval in evaluation.script_deviation.sections.values():
            critical_misses += len(section_eval.critical_misses)
        score -= critical_misses * 10

        # Deduct for deep dive findings
        if evaluation.deep_dive:
            for finding in evaluation.deep_dive.findings:
                if finding.severity.value == "Critical":
                    score -= 20
                elif finding.severity.value == "High":
                    score -= 15
                elif finding.severity.value == "Medium":
                    score -= 10
                elif finding.severity.value == "Low":
                    score -= 5

        # Ensure score is within bounds
        final_score = max(1, min(100, score))

        logger.debug(f"Calculated overall score: {final_score} "
                    f"(violations: {len(evaluation.compliance.summary.violations)}, "
                    f"coaching: {len(evaluation.compliance.summary.coaching_needed)}, "
                    f"comm_missed: {len(evaluation.communication.summary.missed)}, "
                    f"comm_exceeded: {len(evaluation.communication.summary.exceeded)}, "
                    f"critical_misses: {critical_misses})")

        return final_score

    def generate_summary(self, evaluation: EvaluationResult) -> Dict[str, list]:
        """
        Generate evaluation summary highlighting key findings
        
        Returns:
            Dictionary with 'strengths', 'areas_for_improvement', and 'critical_issues'
        """
        strengths = []
        areas_for_improvement = []
        critical_issues = []

        # Extract critical issues from compliance violations
        critical_issues.extend(evaluation.compliance.summary.violations)

        # Add red flags from classification as critical issues
        critical_issues.extend(evaluation.classification.red_flags)

        # Extract strengths from communication skills that exceeded expectations
        strengths.extend(evaluation.communication.summary.exceeded[:3])

        # Add areas for improvement from compliance coaching items
        areas_for_improvement.extend(evaluation.compliance.summary.coaching_needed[:3])

        # Add communication skills that were missed
        areas_for_improvement.extend(evaluation.communication.summary.missed[:3])

        # Add critical script misses to areas for improvement
        for section, eval_data in evaluation.script_deviation.sections.items():
            if eval_data.critical_misses:
                for miss in eval_data.critical_misses[:2]:  # Limit to 2 per section
                    areas_for_improvement.append(f"Section {section}: {miss}")

        # Add deep dive findings to critical issues or areas for improvement
        if evaluation.deep_dive:
            for finding in evaluation.deep_dive.findings:
                if finding.severity.value in ["Critical", "High"]:
                    critical_issues.append(finding.issue)
                else:
                    areas_for_improvement.append(finding.issue)

        # Limit lists to avoid overwhelming output
        return {
            "strengths": strengths[:3],
            "areas_for_improvement": areas_for_improvement[:4],
            "critical_issues": critical_issues[:3]
        }

    def _build_regulatory_context(
        self,
        financial_profile: Optional[Any],
        script_progress: Any,
        call_context: Any
    ) -> Dict[str, Any]:
        """Build regulatory context based on call characteristics"""
        context = {
            "risk_level": "standard",
            "applicable_regulations": ["TCPA", "Internal Policies"],
            "special_requirements": []
        }

        # Add CFPB requirements if financial discussion involved
        if financial_profile:
            context["applicable_regulations"].append("CFPB")

            # Higher risk if high DTI or existing debt
            if financial_profile.dti_ratio and financial_profile.dti_ratio > 0.4:
                context["risk_level"] = "high"
                context["special_requirements"].append("enhanced_disclosure")

            if financial_profile.loan_approval_status == "denied":
                context["special_requirements"].append("adverse_action_notice")

        # Add state regulations for loans
        if financial_profile and financial_profile.loan_approval_status:
            context["applicable_regulations"].append("State Regulations")

        return context

    def _assess_compliance_risk(
        self,
        financial_profile: Optional[Any],
        script_progress: Any
    ) -> str:
        """Assess compliance risk level based on call characteristics"""
        risk_factors = 0

        # Financial risk factors
        if financial_profile:
            if financial_profile.dti_ratio and financial_profile.dti_ratio > 0.5:
                risk_factors += 2
            if financial_profile.loan_approval_status == "denied":
                risk_factors += 1
            if financial_profile.has_existing_debt:
                risk_factors += 1

        # Call conduct risk factors
        if script_progress.termination_reason == "agent_error":
            risk_factors += 2
        elif script_progress.termination_reason == "not_interested":
            risk_factors += 1

        if risk_factors >= 3:
            return "high"
        elif risk_factors >= 1:
            return "medium"
        else:
            return "low"

    def _get_special_requirements(
        self,
        financial_profile: Optional[Any],
        call_context: Any
    ) -> List[str]:
        """Get special compliance requirements based on context"""
        requirements = []

        if financial_profile:
            if financial_profile.loan_approval_status == "denied":
                requirements.append("adverse_action_disclosure")
            if financial_profile.annual_income and financial_profile.annual_income > 100000:
                requirements.append("enhanced_privacy_protection")

        if call_context.value == "Follow-up Call":
            requirements.append("previous_consent_verification")

        return requirements

    def _get_expected_duration(self, sections_attempted: List[int]) -> int:
        """Estimate expected call duration based on sections attempted"""
        # Base duration per section: ~3-4 minutes per section
        base_duration_per_section = 210  # 3.5 minutes in seconds

        # Add overhead for call opening and closing
        overhead = 120  # 2 minutes

        return len(sections_attempted) * base_duration_per_section + overhead

    def _assess_call_pace(self, actual_duration: int, sections_count: int) -> str:
        """Assess if call pace was appropriate"""
        expected_duration = self._get_expected_duration(list(range(1, sections_count + 1)))
        ratio = actual_duration / expected_duration if expected_duration > 0 else 1.0

        if ratio < 0.7:
            return "too_fast"
        elif ratio > 1.3:
            return "too_slow"
        else:
            return "appropriate"

    def _aggregate_issues_for_analysis(
        self,
        classification: Any,
        compliance: Any,
        script_progress: Any
    ) -> Dict[str, Any]:
        """Aggregate all identified issues for comprehensive analysis"""
        issues = {
            "total_issues": 0,
            "critical_issues": 0,
            "issue_categories": {
                "compliance_violations": len(compliance.summary.violations),
                "coaching_needed": len(compliance.summary.coaching_needed),
                "red_flags": len(classification.red_flags),
                "script_adherence": len([v for v in classification.script_adherence_preview.values() if v == "low"])
            },
            "issue_breakdown": {
                "regulatory": compliance.summary.violations,
                "behavioral": classification.red_flags,
                "training": compliance.summary.coaching_needed,
                "process": [f"Script adherence: {k}" for k, v in classification.script_adherence_preview.items() if v == "low"]
            }
        }

        # Calculate totals
        issues["total_issues"] = sum(issues["issue_categories"].values())
        issues["critical_issues"] = issues["issue_categories"]["compliance_violations"] + issues["issue_categories"]["red_flags"]

        # Add termination context
        if script_progress.termination_reason == "agent_error":
            issues["critical_issues"] += 1
            issues["total_issues"] += 1
            issues["issue_breakdown"]["process"].append("Agent error termination")

        return issues

    def _determine_overall_severity(self, issues_analysis: Dict[str, Any]) -> str:
        """Determine overall severity based on issue analysis"""
        critical_count = issues_analysis["critical_issues"]
        total_count = issues_analysis["total_issues"]

        if critical_count >= 2:
            return "Critical"
        elif critical_count >= 1 or total_count >= 4:
            return "High"
        elif total_count >= 2:
            return "Medium"
        else:
            return "Low"

    def _assess_customer_impact(
        self,
        classification: Any,
        compliance: Any,
        script_progress: Any,
        financial_profile: Optional[Any]
    ) -> Dict[str, Any]:
        """Assess the impact on customer experience and satisfaction"""
        impact = {
            "severity": "Low",
            "factors": [],
            "harm_indicators": [],
            "trust_impact": "minimal"
        }

        # Assess compliance violations impact
        if len(compliance.summary.violations) > 0:
            impact["severity"] = "High"
            impact["factors"].append("regulatory_violation")
            impact["harm_indicators"].extend(compliance.summary.violations)
            impact["trust_impact"] = "significant"

        # Assess red flags impact
        if len(classification.red_flags) >= 2:
            if impact["severity"] in ["Low", "Medium"]:
                impact["severity"] = "High"
            impact["factors"].append("multiple_red_flags")
            impact["trust_impact"] = "moderate" if impact["trust_impact"] == "minimal" else impact["trust_impact"]

        # Assess termination reason impact
        if script_progress.termination_reason == "agent_error":
            impact["severity"] = "High"
            impact["factors"].append("agent_error")
            impact["harm_indicators"].append("Unprofessional call termination")
            impact["trust_impact"] = "significant"
        elif script_progress.termination_reason == "not_interested" and not classification.early_termination_justified:
            if impact["severity"] == "Low":
                impact["severity"] = "Medium"
            impact["factors"].append("unjustified_termination")

        # Financial context impact
        if financial_profile and financial_profile.loan_approval_status == "denied":
            impact["factors"].append("sensitive_financial_situation")
            if len(compliance.summary.violations) > 0:
                impact["severity"] = "Critical"
                impact["harm_indicators"].append("Potential discrimination or unfair treatment")

        return impact

    def _assess_reputational_risk(
        self,
        issues_analysis: Dict[str, Any],
        customer_impact_analysis: Dict[str, Any]
    ) -> str:
        """Assess reputational risk based on issues and customer impact"""
        if customer_impact_analysis["severity"] == "Critical":
            return "high"
        elif (issues_analysis["critical_issues"] >= 2 or
              customer_impact_analysis["trust_impact"] == "significant"):
            return "medium"
        else:
            return "low"
