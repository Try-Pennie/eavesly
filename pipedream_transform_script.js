/**
 * Pipedream Data Transformation Script
 *
 * This script transforms data from Supabase and Salesforce into the format
 * expected by the Eavesly /evaluate-call API endpoint.
 *
 * Usage: Copy this code into a new Node.js step in your Pipedream workflow
 * between the Salesforce step and the API call to Eavesly.
 */

export default defineComponent({
  async run({ steps, $ }) {
    // Debug: Log available steps
    console.log("Available steps:", Object.keys(steps));

    // Log each step's structure for debugging
    Object.keys(steps).forEach(stepName => {
      console.log(`Step ${stepName}:`, steps[stepName]);
    });

    // Find the supabase step (look for variations in naming)
    const supabaseStepName = Object.keys(steps).find(name =>
      name.includes('supabase') || name.includes('fetch_call')
    );

    // Find the salesforce step
    const salesforceStepName = Object.keys(steps).find(name =>
      name.includes('salesforce') || name.includes('skylink')
    );

    if (!supabaseStepName) {
      throw new Error(`No supabase step found. Available steps: ${Object.keys(steps).join(', ')}`);
    }

    if (!salesforceStepName) {
      throw new Error(`No salesforce step found. Available steps: ${Object.keys(steps).join(', ')}`);
    }

    console.log(`Using supabase step: ${supabaseStepName}`);
    console.log(`Using salesforce step: ${salesforceStepName}`);

    const supabaseData = steps[supabaseStepName].$return_value;
    const salesforceData = steps[salesforceStepName].$return_value.records[0];

    // Debug: Log the full data structures
    console.log("Supabase data structure:", JSON.stringify(supabaseData, null, 2));
    console.log("Salesforce data structure:", JSON.stringify(salesforceData, null, 2));

    // Validate required data exists
    if (!supabaseData) {
      throw new Error("No data returned from Supabase step");
    }

    if (!salesforceData) {
      throw new Error("No data returned from Salesforce step");
    }

    // Map Salesforce boolean flags to sections attempted
    const sectionMapping = {
      'AgentInputs__c': 1,
      'CreditReportReview__c': 2,
      'DTIReview__c': 3,
      'Paydown__c': 4,
      'LoanOffers__c': 5,
      'DebtResolution__c': 6
    };

    const sectionsAttempted = [];
    let lastCompletedSection = 0;

    // Convert boolean flags to section numbers
    Object.entries(sectionMapping).forEach(([field, sectionNum]) => {
      if (salesforceData[field] === true) {
        sectionsAttempted.push(sectionNum);
        lastCompletedSection = Math.max(lastCompletedSection, sectionNum);
      }
    });

    // Ensure we have at least one section attempted (API requirement)
    if (sectionsAttempted.length === 0) {
      sectionsAttempted.push(1);
      lastCompletedSection = 1;
    }

    // Determine call context (you may want to adjust this logic)
    const callContext = "First Call"; // TODO: Add logic to determine if follow-up

    // Transform to Eavesly API format with safe property access
    const transformedPayload = {
      call_id: supabaseData.call_id || "unknown",
      agent_id: supabaseData.call_data?.agent_email || supabaseData.agent_email || "unknown",
      call_context: callContext,
      transcript: {
        transcript: supabaseData.transcription_qa_data?.original_transcript || supabaseData.transcript || "",
        metadata: {
          duration: supabaseData.call_data?.handle_time || supabaseData.duration || 0,
          timestamp: supabaseData.call_data?.created_at || supabaseData.created_at || new Date().toISOString(),
          talk_time: supabaseData.call_data?.talk_time || supabaseData.talk_time || 0,
          disposition: supabaseData.call_data?.disposition || supabaseData.disposition || "unknown",
          campaign_name: supabaseData.call_data?.campaign_name || supabaseData.campaign_name || null
        }
      },
      ideal_script: "Section 1: Agent Inputs - Gather basic information and confirm customer details\nSection 2: Credit Report Review - Review credit report with customer and get authorization\nSection 3: DTI Review - Analyze debt-to-income ratio and cash flow\nSection 4: Paydown Projections - Present paydown scenarios and projections\nSection 5: Loan Offers - Present available loan options and terms\nSection 6: Debt Resolution - Discuss debt resolution alternatives if no loan available",
      client_data: {
        lead_id: supabaseData.call_data?.sfdc_lead_id || supabaseData.sfdc_lead_id || null,
        campaign_id: supabaseData.call_data?.campaign_id || supabaseData.campaign_id || null,
        script_progress: {
          sections_attempted: sectionsAttempted,
          last_completed_section: lastCompletedSection,
          termination_reason: supabaseData.call_data?.disposition || supabaseData.disposition || "unknown",
          pitch_outcome: supabaseData.transcription_qa_data?.qa_json?.call_overview?.call_outcome || supabaseData.call_outcome || null
        },
        financial_profile: {
          annual_income: null, // Could extract from transcript if needed
          dti_ratio: null, // Could extract from QA data if available
          loan_approval_status: (supabaseData.transcription_qa_data?.qa_json?.call_overview?.call_outcome || "").includes("not qualify") ? "denied" : "pending",
          has_existing_debt: true // Could infer from transcript/QA data
        }
      }
    };

    // Log the transformation for debugging
    console.log("Transformed payload:", JSON.stringify(transformedPayload, null, 2));

    return transformedPayload;
  }
});