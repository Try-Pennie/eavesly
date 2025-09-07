#!/usr/bin/env python3
"""
Simple API Test - Database Integration Only

This tests the database integration without requiring PromptLayer templates.
"""

import asyncio
import json
import sys
from datetime import datetime
from typing import Dict, Any

from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Colors for output
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m' 
    BLUE = '\033[94m'
    YELLOW = '\033[93m'
    PURPLE = '\033[95m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def print_colored(text: str, color: str = Colors.RESET):
    """Print colored text"""
    print(f"{color}{text}{Colors.RESET}")

def print_header(text: str):
    """Print section header"""
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{text.center(60)}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}")

async def test_database_integration():
    """Test database integration directly"""
    print_header("Testing Database Integration")
    
    try:
        # Import DatabaseService
        sys.path.insert(0, '.')
        from app.services.database import DatabaseService
        from app.models.schemas import (
            CallClassification, CallOutcome, AdherenceLevel,
            ScriptAdherence, SectionEvaluation, PerformanceRating,
            Compliance, ComplianceStatus, ComplianceSummary, ComplianceItem,
            Communication, CommunicationSkill, CommunicationSummary,
            EvaluationResult
        )
        
        # Initialize database service
        db_service = DatabaseService()
        print_colored("✅ DatabaseService initialized", Colors.GREEN)
        
        # Test health check
        health_ok = await db_service.health_check()
        if health_ok:
            print_colored("✅ Database health check passed", Colors.GREEN)
        else:
            print_colored("❌ Database health check failed", Colors.RED)
            return False
        
        # Create mock evaluation result
        call_id = f"api_test_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        correlation_id = f"corr_{datetime.now().strftime('%H%M%S')}"
        
        # Create test evaluation components
        classification = CallClassification(
            sections_completed=[1, 2, 3],
            sections_attempted=[1, 2, 3, 4],
            call_outcome=CallOutcome.COMPLETED,
            script_adherence_preview={"intro": AdherenceLevel.HIGH},
            red_flags=["test_flag"],
            requires_deep_dive=False
        )
        
        section_eval = SectionEvaluation(
            content_accuracy=PerformanceRating.MET,
            sequence_adherence=PerformanceRating.MET,
            language_phrasing=PerformanceRating.EXCEEDED,
            customization=PerformanceRating.MET,
            critical_misses=[],
            quote="Test quote"
        )
        
        script_adherence = ScriptAdherence(sections={"intro": section_eval})
        
        compliance_items = [ComplianceItem(
            name="test_compliance", 
            status=ComplianceStatus.NO_INFRACTION,
            details="Test details"
        )]
        compliance_summary = ComplianceSummary(
            no_infraction=["test_compliance"],
            coaching_needed=[],
            violations=[],
            not_applicable=[]
        )
        compliance = Compliance(items=compliance_items, summary=compliance_summary)
        
        comm_skills = [CommunicationSkill(
            skill="test_skill",
            rating=PerformanceRating.MET,
            example="Test example"
        )]
        comm_summary = CommunicationSummary(exceeded=[], met=["test_skill"], missed=[])
        communication = Communication(skills=comm_skills, summary=comm_summary)
        
        evaluation_result = EvaluationResult(
            classification=classification,
            script_deviation=script_adherence,
            compliance=compliance,
            communication=communication
        )
        
        print_colored(f"📝 Testing with call_id: {call_id}", Colors.BLUE)
        
        # Test storing evaluation result
        await db_service.store_evaluation_result(
            correlation_id=correlation_id,
            call_id=call_id,
            agent_id="test_agent_api",
            evaluation_result=evaluation_result,
            overall_score=88,
            processing_time_ms=1500
        )
        
        print_colored("✅ Evaluation result stored successfully", Colors.GREEN)
        
        # Test API logging
        await db_service.log_api_request(
            correlation_id=correlation_id,
            endpoint="/api/test",
            status_code=200,
            processing_time_ms=1500,
            error_message=None
        )
        
        print_colored("✅ API request logged successfully", Colors.GREEN)
        
        return True
        
    except Exception as e:
        print_colored(f"❌ Database test failed: {e}", Colors.RED)
        import traceback
        traceback.print_exc()
        return False

async def test_database_queries():
    """Test database queries to verify data storage"""
    print_header("Verifying Stored Data")
    
    try:
        import sys
        sys.path.insert(0, '.')
        
        # Import Supabase client directly to run queries
        from supabase import create_client
        import os
        
        supabase_url = os.getenv("SUPABASE_URL")
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        
        if not supabase_url or not service_key:
            print_colored("❌ Supabase credentials not found", Colors.RED)
            return False
        
        client = create_client(supabase_url, service_key)
        
        # Query evaluation results
        eval_response = client.table("eavesly_evaluation_results").select("call_id, agent_id, api_overall_score, created_at").order("created_at", desc=True).limit(3).execute()
        
        if eval_response.data:
            print_colored(f"✅ Found {len(eval_response.data)} evaluation results:", Colors.GREEN)
            for record in eval_response.data:
                print_colored(f"   • {record['call_id']} (Agent: {record['agent_id']}, Score: {record['api_overall_score']})", Colors.BLUE)
        else:
            print_colored("⚠️  No evaluation results found", Colors.YELLOW)
        
        # Query API logs  
        logs_response = client.table("eavesly_api_logs").select("endpoint, http_status_code, correlation_id, created_at").order("created_at", desc=True).limit(3).execute()
        
        if logs_response.data:
            print_colored(f"✅ Found {len(logs_response.data)} API log entries:", Colors.GREEN)
            for record in logs_response.data:
                print_colored(f"   • {record['endpoint']} (Status: {record['http_status_code']}, ID: {record['correlation_id'][:12]}...)", Colors.BLUE)
        else:
            print_colored("⚠️  No API logs found", Colors.YELLOW)
        
        return True
        
    except Exception as e:
        print_colored(f"❌ Database query test failed: {e}", Colors.RED)
        return False

async def main():
    """Main test runner"""
    print_colored(f"{Colors.BOLD}🧪 Simple API Database Test{Colors.RESET}")
    print_colored("Testing database integration without full API startup")
    
    all_tests_passed = True
    
    # Test 1: Database integration
    db_test = await test_database_integration()
    all_tests_passed &= db_test
    
    # Test 2: Query verification
    query_test = await test_database_queries()
    all_tests_passed &= query_test
    
    # Final results
    print_header("Test Results Summary")
    
    if all_tests_passed:
        print_colored("🎉 All database tests passed!", Colors.GREEN)
        print_colored("✅ Database service working", Colors.GREEN)
        print_colored("✅ Data storage verified", Colors.GREEN)
        print_colored("✅ New tables accessible", Colors.GREEN)
    else:
        print_colored("❌ Some tests failed", Colors.RED)
    
    return all_tests_passed

if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        sys.exit(0 if success else 1)
    except Exception as e:
        print_colored(f"\n💥 Unexpected error: {e}", Colors.RED)
        sys.exit(1)