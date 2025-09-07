#!/usr/bin/env python3
"""
Test script for Supabase database integration.

This script tests all DatabaseService methods to ensure proper connectivity
and functionality with the new dedicated tables.
"""

import asyncio
import sys
import uuid
from datetime import datetime
from typing import Dict, Any
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Add the app directory to Python path
sys.path.insert(0, '.')

from app.services.database import DatabaseService
from app.models.schemas import (
    CallClassification, CallOutcome, AdherenceLevel,
    ScriptAdherence, SectionEvaluation, PerformanceRating,
    Compliance, ComplianceStatus, ComplianceSummary, ComplianceItem,
    Communication, CommunicationSkill, CommunicationSummary,
    EvaluationResult
)


async def create_test_evaluation_result() -> EvaluationResult:
    """Create a test evaluation result with all required data"""
    
    # Create test classification
    classification = CallClassification(
        sections_completed=[1, 2, 3],
        sections_attempted=[1, 2, 3, 4],
        call_outcome=CallOutcome.COMPLETED,
        script_adherence_preview={"intro": AdherenceLevel.HIGH, "close": AdherenceLevel.MEDIUM},
        red_flags=["interruption_noted"],
        requires_deep_dive=False,
        early_termination_justified=True
    )
    
    # Create test script adherence
    section_eval = SectionEvaluation(
        content_accuracy=PerformanceRating.MET,
        sequence_adherence=PerformanceRating.MET,
        language_phrasing=PerformanceRating.EXCEEDED,
        customization=PerformanceRating.MET,
        critical_misses=["missed_objection_handling"],
        quote="Great opening, strong delivery"
    )
    
    script_adherence = ScriptAdherence(
        sections={"intro": section_eval, "close": section_eval}
    )
    
    # Create test compliance
    compliance_items = [
        ComplianceItem(
            name="TCPA_compliance",
            status=ComplianceStatus.NO_INFRACTION,
            details="Proper consent obtained"
        ),
        ComplianceItem(
            name="DNC_check",
            status=ComplianceStatus.NO_INFRACTION,
            details="Customer not on DNC list"
        )
    ]
    
    compliance_summary = ComplianceSummary(
        no_infraction=["TCPA_compliance", "DNC_check"],
        coaching_needed=[],
        violations=[],
        not_applicable=["state_specific_rules"]
    )
    
    compliance = Compliance(
        items=compliance_items,
        summary=compliance_summary
    )
    
    # Create test communication
    comm_skills = [
        CommunicationSkill(
            skill="active_listening",
            rating=PerformanceRating.MET,
            example="Agent acknowledged customer concerns"
        ),
        CommunicationSkill(
            skill="empathy",
            rating=PerformanceRating.EXCEEDED,
            example="Showed genuine understanding"
        )
    ]
    
    comm_summary = CommunicationSummary(
        exceeded=["empathy"],
        met=["active_listening"],
        missed=[]
    )
    
    communication = Communication(
        skills=comm_skills,
        summary=comm_summary
    )
    
    # Create complete evaluation result
    return EvaluationResult(
        classification=classification,
        script_deviation=script_adherence,
        compliance=compliance,
        communication=communication,
        deep_dive=None  # Not required for this test
    )


async def test_database_service():
    """Test all DatabaseService methods"""
    print("🧪 Starting Database Integration Tests")
    print("=" * 50)
    
    # Initialize database service
    try:
        db_service = DatabaseService()
        print("✅ DatabaseService initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize DatabaseService: {e}")
        return False
    
    # Test 1: Health Check
    print("\n1️⃣ Testing health_check()")
    try:
        is_healthy = await db_service.health_check()
        if is_healthy:
            print("✅ Database health check passed")
        else:
            print("❌ Database health check failed")
            return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False
    
    # Test 2: Store Evaluation Result
    print("\n2️⃣ Testing store_evaluation_result()")
    try:
        # Generate test data
        correlation_id = str(uuid.uuid4())
        call_id = f"test_call_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        agent_id = "test_agent_001"
        evaluation_result = await create_test_evaluation_result()
        overall_score = 85
        processing_time_ms = 1250
        
        print(f"   📝 Test data: call_id={call_id}, agent_id={agent_id}")
        
        await db_service.store_evaluation_result(
            correlation_id=correlation_id,
            call_id=call_id,
            agent_id=agent_id,
            evaluation_result=evaluation_result,
            overall_score=overall_score,
            processing_time_ms=processing_time_ms
        )
        
        print("✅ Evaluation result stored successfully")
        
    except Exception as e:
        print(f"❌ Failed to store evaluation result: {e}")
        return False
    
    # Test 3: Log API Request
    print("\n3️⃣ Testing log_api_request()")
    try:
        await db_service.log_api_request(
            correlation_id=correlation_id,
            endpoint="/evaluate",
            status_code=200,
            processing_time_ms=processing_time_ms,
            error_message=None
        )
        
        print("✅ API request logged successfully")
        
    except Exception as e:
        print(f"❌ Failed to log API request: {e}")
        return False
    
    # Test 4: Error handling (log API request with error)
    print("\n4️⃣ Testing error logging")
    try:
        error_correlation_id = str(uuid.uuid4())
        await db_service.log_api_request(
            correlation_id=error_correlation_id,
            endpoint="/evaluate",
            status_code=500,
            processing_time_ms=500,
            error_message="Test error for logging verification"
        )
        
        print("✅ Error logging test completed")
        
    except Exception as e:
        print(f"❌ Error logging test failed: {e}")
        return False
    
    print("\n🎉 All database integration tests passed!")
    print("=" * 50)
    print(f"📊 Test Summary:")
    print(f"   • Health check: ✅")
    print(f"   • Evaluation storage: ✅")
    print(f"   • API logging: ✅") 
    print(f"   • Error handling: ✅")
    print(f"   • Test call_id: {call_id}")
    print(f"   • Test correlation_id: {correlation_id}")
    
    return True


async def main():
    """Main test runner"""
    print("🚀 Database Integration Test Suite")
    print("Testing connection to new dedicated tables:")
    print("  • eavesly_evaluation_results")
    print("  • eavesly_api_logs")
    print()
    
    success = await test_database_service()
    
    if success:
        print("\n✅ All tests completed successfully!")
        print("   Database integration is working correctly with new tables.")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed!")
        print("   Please check the error messages above.")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())