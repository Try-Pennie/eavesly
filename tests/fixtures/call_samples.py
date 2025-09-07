"""
Test data fixtures for various call scenarios.

Provides sample data for different types of calls and situations
that the evaluation system might encounter.
"""

from datetime import datetime
from typing import Dict, Any

from app.models.requests import (
    EvaluateCallRequest, CallContext, TranscriptData, TranscriptMetadata,
    ClientData, ScriptProgress, FinancialProfile
)
from app.models.schemas import CallOutcome, AdherenceLevel, PerformanceRating, ComplianceStatus


class CallSamples:
    """Collection of sample call data for testing"""
    
    @staticmethod
    def successful_loan_approved() -> EvaluateCallRequest:
        """Sample of a successful call resulting in loan approval"""
        return EvaluateCallRequest(
            call_id="success_001",
            agent_id="agent_sarah",
            call_context=CallContext.FIRST_CALL,
            transcript=TranscriptData(
                transcript="""
Agent: Good morning! This is Sarah from Pennie Financial Services. I understand you submitted an inquiry about our personal loan products. Is this John Smith?

Client: Yes, that's me. Thanks for calling back so quickly.

Agent: Wonderful! I'm excited to help you explore your options today. Before we dive in, may I ask what prompted your interest in a personal loan?

Client: Well, I'm looking to consolidate some credit card debt and maybe do a small home improvement project.

Agent: That's a great use for a personal loan. Debt consolidation can really help simplify your finances and potentially save you money on interest. Can you tell me roughly how much you're looking to borrow?

Client: I'm thinking around $25,000 would cover everything.

Agent: Perfect. Based on our initial review of your application, you have excellent credit and steady income. I'm pleased to let you know that we can approve you for a $25,000 personal loan at 6.9% APR with a 5-year term. Your monthly payment would be approximately $495.

Client: That sounds great! The rate is better than what I'm paying on my credit cards.

Agent: Exactly! You'll save money every month. Would you like me to walk you through the next steps to get this finalized today?

Client: Yes, let's do it.

Agent: Excellent! I'll send you the loan documents electronically. You can review and sign them at your convenience. Is the email address we have on file still current?

Client: Yes, johnsmith@email.com is correct.

Agent: Perfect. You should receive the documents within the next hour. Once you sign and return them, we can have the funds in your account within 2-3 business days. Do you have any questions about the loan terms or process?

Client: No, this all sounds straightforward. Thank you so much for your help!

Agent: You're very welcome, John! I'm thrilled we could help you achieve your financial goals today. You'll receive a confirmation email shortly, and please don't hesitate to call if you have any questions. Have a wonderful day!

Client: Thank you, Sarah. You too!
                """.strip(),
                metadata=TranscriptMetadata(
                    duration=420,  # 7 minutes
                    timestamp=datetime(2024, 1, 15, 10, 30, 0),
                    talk_time=350,
                    disposition="loan_approved",
                    campaign_name="Personal Loans Q1"
                )
            ),
            ideal_script="Section 1: Warm greeting and identification\nSection 2: Needs discovery and qualification\nSection 3: Product presentation and benefits\nSection 4: Objection handling (if needed)\nSection 5: Application completion and next steps",
            client_data=ClientData(
                lead_id="lead_success_001",
                campaign_id=101,
                script_progress=ScriptProgress(
                    sections_attempted=[1, 2, 3, 5],  # Skipped objection handling
                    last_completed_section=5,
                    termination_reason="loan_approved",
                    pitch_outcome="approved"
                ),
                financial_profile=FinancialProfile(
                    annual_income=85000.0,
                    dti_ratio=0.28,
                    loan_approval_status="approved", 
                    has_existing_debt=True
                )
            )
        )
    
    @staticmethod
    def compliance_violation_call() -> EvaluateCallRequest:
        """Sample call with significant compliance violations"""
        return EvaluateCallRequest(
            call_id="violation_001",
            agent_id="agent_mike",
            call_context=CallContext.FIRST_CALL,
            transcript=TranscriptData(
                transcript="""
Agent: Yeah, hi, this is Mike. You filled out some form online about a loan, right?

Client: Um, yes, I think so. Who is this?

Agent: Mike from... uh... some loan company. Look, I've got great news - you're pre-approved for $50,000 right now. We need to move fast though.

Client: Wait, I didn't apply for that much. And which company are you with?

Agent: Don't worry about the details. The important thing is you're approved. But this offer expires in 30 minutes, so we need your social security number and bank account info right now.

Client: I'm not comfortable giving that information over the phone to someone I don't know.

Agent: Look, lady, this is a limited-time offer. If you don't want free money, that's your problem. Other people would kill for this opportunity.

Client: This doesn't seem right. I'm going to hang up.

Agent: Fine, but don't come crying to me when you can't get credit anywhere else. Your credit is probably terrible anyway.

Client: [Click - call ends]
                """.strip(),
                metadata=TranscriptMetadata(
                    duration=180,  # 3 minutes
                    timestamp=datetime(2024, 1, 15, 15, 45, 0),
                    talk_time=150,
                    disposition="hung_up",
                    campaign_name="Personal Loans Q1"
                )
            ),
            ideal_script="Section 1: Professional greeting and company identification\nSection 2: Needs assessment and qualification\nSection 3: Product presentation with clear disclosures\nSection 4: Objection handling with respect\nSection 5: Professional closing",
            client_data=ClientData(
                lead_id="lead_violation_001",
                campaign_id=101,
                script_progress=ScriptProgress(
                    sections_attempted=[1],  # Only attempted greeting
                    last_completed_section=0,
                    termination_reason="agent_error",
                    pitch_outcome="failed"
                ),
                financial_profile=FinancialProfile(
                    annual_income=45000.0,
                    dti_ratio=0.55,
                    loan_approval_status="pending",
                    has_existing_debt=True
                )
            )
        )
    
    @staticmethod
    def client_not_interested() -> EvaluateCallRequest:
        """Sample call where client is legitimately not interested"""
        return EvaluateCallRequest(
            call_id="not_interested_001",
            agent_id="agent_lisa",
            call_context=CallContext.FOLLOW_UP_CALL,
            transcript=TranscriptData(
                transcript="""
Agent: Good afternoon, this is Lisa calling from Pennie Financial Services. I'm following up on your inquiry about personal loans. Is this a good time to speak with Mary Johnson?

Client: Oh yes, I remember filling out that form. Actually, my situation has changed since then.

Agent: I understand. Would you mind sharing what's changed? Perhaps I can still help you find a solution.

Client: Well, I ended up getting a loan from my credit union at a really good rate. I appreciate you calling, but I'm all set now.

Agent: That's wonderful that you found a solution! I'm glad you were able to get the financing you needed. Credit unions can indeed offer competitive rates.

Client: Yes, they really took care of me. Thank you for understanding.

Agent: Of course! We're always here if your needs change in the future. Would you like me to remove you from our contact list?

Client: Yes, please do. But thank you for being so professional about this.

Agent: You're very welcome, Mary. I'll make sure you're removed from our system right away. Have a great day!

Client: Thank you, you too!
                """.strip(),
                metadata=TranscriptMetadata(
                    duration=240,  # 4 minutes
                    timestamp=datetime(2024, 1, 16, 14, 20, 0),
                    talk_time=200,
                    disposition="not_interested",
                    campaign_name="Personal Loans Q1 Follow-up"
                )
            ),
            ideal_script="Section 1: Warm greeting and identification\nSection 2: Follow-up on previous interest\nSection 3: Needs reassessment\nSection 4: Professional handling of objections\nSection 5: Respectful closing",
            client_data=ClientData(
                lead_id="lead_not_interested_001",
                campaign_id=102,
                script_progress=ScriptProgress(
                    sections_attempted=[1, 2, 4, 5],
                    last_completed_section=5,
                    termination_reason="not_interested",
                    pitch_outcome="declined"
                ),
                financial_profile=FinancialProfile(
                    annual_income=62000.0,
                    dti_ratio=0.32,
                    loan_approval_status="pending",
                    has_existing_debt=False
                )
            )
        )
    
    @staticmethod
    def incomplete_call_technical_issues() -> EvaluateCallRequest:
        """Sample call that ended due to technical issues"""
        return EvaluateCallRequest(
            call_id="technical_001",
            agent_id="agent_carlos",
            call_context=CallContext.FIRST_CALL,
            transcript=TranscriptData(
                transcript="""
Agent: Good morning! This is Carlos from Pennie Financial Services. I'm calling regarding your personal loan inquiry. Is this Robert Martinez?

Client: Yes, that's me. Thanks for calling.

Agent: Great! I'm excited to help you explore your loan options today. I see from your application that you're interested in approximately $15,000 for home improvements. Is that still accurate?

Client: Yes, exactly. We're looking to update our kitchen.

Agent: That's a great investment in your home. Based on your application, your credit score and income look very strong. I believe we can offer you some excellent options. Let me pull up the specific rates and terms for you...

[Long pause]

Agent: I'm sorry, I'm having some technical difficulties with our system. Can you hear me okay?

Client: Yes, I can hear you fine.

Agent: Great. Let me try accessing your information from a different system... 

[Extended silence]

Client: Hello? Are you still there?

Agent: Yes, I'm here. I'm really sorry about this. Our system seems to be down right now. Rather than keep you waiting, would it be okay if I call you back within the next hour once we get this resolved?

Client: Sure, that's fine. I should be available.

Agent: Perfect. I have your number as 555-123-4567. I'll call you back shortly with your loan options. Again, I apologize for the inconvenience.

Client: No problem, these things happen. Talk to you soon.

Agent: Thank you for your patience, Robert. Goodbye.
                """.strip(),
                metadata=TranscriptMetadata(
                    duration=300,  # 5 minutes
                    timestamp=datetime(2024, 1, 17, 11, 15, 0),
                    talk_time=240,
                    disposition="callback_scheduled",
                    campaign_name="Personal Loans Q1"
                )
            ),
            ideal_script="Section 1: Professional greeting and identification\nSection 2: Needs confirmation and qualification\nSection 3: Product presentation and rates\nSection 4: Objection handling\nSection 5: Application completion",
            client_data=ClientData(
                lead_id="lead_technical_001",
                campaign_id=101,
                script_progress=ScriptProgress(
                    sections_attempted=[1, 2],  # Only got through first two sections
                    last_completed_section=2,
                    termination_reason="callback_scheduled",
                    pitch_outcome="pending"
                ),
                financial_profile=FinancialProfile(
                    annual_income=78000.0,
                    dti_ratio=0.25,
                    loan_approval_status="pending",
                    has_existing_debt=False
                )
            )
        )
    
    @staticmethod
    def high_risk_denial_call() -> EvaluateCallRequest:
        """Sample call involving loan denial for high-risk client"""
        return EvaluateCallRequest(
            call_id="denial_001",
            agent_id="agent_jennifer",
            call_context=CallContext.FIRST_CALL,
            transcript=TranscriptData(
                transcript="""
Agent: Good afternoon, this is Jennifer calling from Pennie Financial Services. I'm calling to follow up on your loan application. Is this David Thompson?

Client: Yes, this is David. I've been waiting to hear back from you.

Agent: Thank you for your patience, David. I've completed the review of your application for the $20,000 personal loan. I want to be completely transparent with you about our findings.

Client: Okay, that sounds serious.

Agent: Unfortunately, based on our underwriting review, we're not able to approve your loan application at this time. This decision is primarily due to your current debt-to-income ratio and some recent credit inquiries.

Client: Oh no. Is there anything I can do? I really need this loan to consolidate my debts.

Agent: I understand how disappointing this must be. While we can't approve the loan today, I want to provide you with some options. First, you'll receive a detailed adverse action notice in the mail within 7-10 business days explaining exactly why we couldn't approve your application.

Client: What kinds of things would help me qualify in the future?

Agent: Great question. The main factors were your debt-to-income ratio, which is currently around 65%. If you could pay down some of your existing debt to get that below 50%, it would significantly improve your chances. Also, avoiding new credit inquiries for the next 6 months would help.

Client: That makes sense. How long should I wait before applying again?

Agent: I'd recommend waiting at least 6 months and focusing on paying down your existing debt during that time. We'd be happy to reconsider your application then. 

Client: Okay, I appreciate your honesty and the advice. It's disappointing, but I understand.

Agent: I'm sorry we couldn't help you today, David. Is there anything else I can clarify about the decision or the next steps?

Client: No, I think you've explained it well. I'll work on my debt and try again later.

Agent: That sounds like a solid plan. Best of luck, and please don't hesitate to call if you have any questions about the adverse action notice when you receive it.

Client: Thank you, Jennifer. I appreciate your help.

Agent: You're welcome, David. Have a good day.
                """.strip(),
                metadata=TranscriptMetadata(
                    duration=480,  # 8 minutes
                    timestamp=datetime(2024, 1, 18, 16, 30, 0),
                    talk_time=420,
                    disposition="loan_denied",
                    campaign_name="Personal Loans Q1"
                )
            ),
            ideal_script="Section 1: Professional greeting and identification\nSection 2: Application status disclosure\nSection 3: Denial explanation with adverse action notice\nSection 4: Alternative options and recommendations\nSection 5: Professional closing with next steps",
            client_data=ClientData(
                lead_id="lead_denial_001",
                campaign_id=101,
                script_progress=ScriptProgress(
                    sections_attempted=[1, 2, 3, 4, 5],
                    last_completed_section=5,
                    termination_reason="loan_denied",
                    pitch_outcome="denied"
                ),
                financial_profile=FinancialProfile(
                    annual_income=48000.0,
                    dti_ratio=0.65,  # High DTI
                    loan_approval_status="denied",
                    has_existing_debt=True
                )
            )
        )
    
    @staticmethod
    def get_all_samples() -> Dict[str, EvaluateCallRequest]:
        """Get all sample calls as a dictionary"""
        return {
            "successful_loan_approved": CallSamples.successful_loan_approved(),
            "compliance_violation_call": CallSamples.compliance_violation_call(),
            "client_not_interested": CallSamples.client_not_interested(),
            "incomplete_technical_issues": CallSamples.incomplete_call_technical_issues(),
            "high_risk_denial": CallSamples.high_risk_denial_call()
        }
    
    @staticmethod
    def get_expected_outcomes() -> Dict[str, Dict[str, Any]]:
        """Get expected evaluation outcomes for each sample"""
        return {
            "successful_loan_approved": {
                "deep_dive_required": False,
                "overall_score_range": (85, 100),
                "call_outcome": CallOutcome.COMPLETED,
                "compliance_violations_expected": 0,
                "red_flags_expected": 0
            },
            "compliance_violation_call": {
                "deep_dive_required": True,
                "overall_score_range": (1, 30),
                "call_outcome": CallOutcome.LOST,
                "compliance_violations_expected": 3,  # Multiple violations expected
                "red_flags_expected": 2  # Multiple red flags expected
            },
            "client_not_interested": {
                "deep_dive_required": False,
                "overall_score_range": (70, 90),
                "call_outcome": CallOutcome.LOST,
                "compliance_violations_expected": 0,
                "red_flags_expected": 0
            },
            "incomplete_technical_issues": {
                "deep_dive_required": False,
                "overall_score_range": (60, 80),
                "call_outcome": CallOutcome.INCOMPLETE,
                "compliance_violations_expected": 0,
                "red_flags_expected": 0
            },
            "high_risk_denial": {
                "deep_dive_required": False,  # Professional denial handling
                "overall_score_range": (75, 95),
                "call_outcome": CallOutcome.COMPLETED,
                "compliance_violations_expected": 0,
                "red_flags_expected": 0
            }
        }


# Additional utility functions for testing

def get_sample_by_scenario(scenario: str) -> EvaluateCallRequest:
    """Get a specific sample call by scenario name"""
    samples = CallSamples.get_all_samples()
    if scenario not in samples:
        raise ValueError(f"Unknown scenario: {scenario}. Available: {list(samples.keys())}")
    return samples[scenario]


def get_expected_outcome(scenario: str) -> Dict[str, Any]:
    """Get expected evaluation outcome for a scenario"""
    outcomes = CallSamples.get_expected_outcomes()
    if scenario not in outcomes:
        raise ValueError(f"Unknown scenario: {scenario}. Available: {list(outcomes.keys())}")
    return outcomes[scenario]