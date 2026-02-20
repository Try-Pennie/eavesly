import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.test from project root
config({ path: resolve(__dirname, "..", ".env.test") })

const API_KEY = process.env.EAVESLY_API_KEY
const BASE_URL = process.env.EAVESLY_BASE_URL

if (!API_KEY || !BASE_URL) {
  console.error("Missing EAVESLY_API_KEY or EAVESLY_BASE_URL in .env.test")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Test fixture — real call WT7882b5702ef52891e771147edc5987dd
// Transcript pulled from eavesly_transcription_qa.original_transcript
// ---------------------------------------------------------------------------
const TRANSCRIPT = `[contact]: Hello. Is this David?
[handling agent]: Hey, Albert. This is David. How are you?
[contact]: Well, I just got home right now. I probably should've needed another 20 minutes, but do you have
[handling agent]: Okay. I
[contact]: 20 minutes, or you can you call me back in 20 minutes?
[handling agent]: can, yeah, I can definitely try. Yeah.
[contact]: Or you wanna
[contact]: tell you what.
[handling agent]: Yeah. If we can't
[contact]: I'm trying to get my computer up.
[handling agent]: no. It's all good. Would it be better to talk tomorrow?
[contact]: No. What's wrong with the computer?
[contact]: I don't know. What do you have for me? That's why I told you it's another day. What's that? Okay.
[contact]: Okay. No, David. We can do it right here right now.
[contact]: 40 Okay.
[handling agent]: Sure. Okay.
[contact]: I'm trying to $40,000.
[handling agent]: Okay.
[contact]: So go ahead. Let me do it right now. I can wait.
[handling agent]: Alright. Let's
[contact]: Okay. What what website
[handling agent]: go ahead and see what
[contact]: should I go on right now?
[handling agent]: yeah. We'll do everything by text, so don't yeah. I'll I'll send you it I'll send you
[contact]: Bye bye.
[handling agent]: the link you need. Okay. So
[contact]: Okay. Go ahead.
[handling agent]: it looks. And did you want the did you want the money to, get so by the way, I don't know if I said earlier. This is Dave on a recorded line with Penny. Did you want to, get this money to make a purchase, or were you trying to pay off some debt?
[contact]: I wanted to put it in my bank account and do what I want with it. But this is yeah. I didn't wanna make note. I have a bathroom that needs to be retiled. I'm not sure how much it's gonna cost me.
[contact]: It could be $1,015,000.
[handling agent]: Gotcha. Okay.
[contact]: And then I have a and then I have a then I have another car payment that I card that I have to pay off right
[handling agent]: Got it.
[contact]: away because it yeah. So
[handling agent]: Alright. Well, it's a pretty quick
[contact]: that's.
[handling agent]: process. It takes about takes about, say, 10 to 15 minutes or so. Let me go ahead and look up here. So
[contact]: Okay.
[handling agent]: we'll do a soft credit pull. No effect to your score. Just kinda need to see, like, you know, who you owe and what you owe. Let's see. Alright.
[handling agent]: Give me a second here.
[contact]: Yeah.
[handling agent]: Okay. Cool. So, income looks like you're earning about $96,000 a year before taxes. Is that correct?
[contact]: That's correct.
[handling agent]: Okay. And then you're paid twice monthly. So, Albert, after, taxes, retirement benefits come out, what are you, netting on those checks?
[contact]: Probably around the net would probably be probably $70.75, 80,000.
[handling agent]: Okay.
[contact]: Mhmm.
[handling agent]: 8,000 per check?
[contact]: Well,
[handling agent]: Well, that's per month.
[contact]: I get the I get I get 2,500 for Social Security.
[handling agent]: Gotcha. Okay.
[contact]: So that's combined with and then then I get another $3,500 for another $3,500 for my regular employment,
[handling agent]: Gotcha.
[contact]: and then I get a com then I get commission for another thousand.
[handling agent]: Okay. So we're looking at $3,500 times 2 for your w 2 job. And then
[contact]: Yes. 4 4000
[handling agent]: alright. Then
[contact]: $4.05 4,500 with commission.
[handling agent]: And as is that commission paid out on each check or just the second check of the month?
[contact]: Paid
[contact]: up on the second check-in a month.
[handling agent]: Okay.
[contact]: Yeah.
[handling agent]: It's about 3,500 plus 4,500 and then plus 2,500. And then, you said you get, so about 10,500 per month after taxes?
[contact]: Did you say 10,500?
[handling agent]: Yeah. So if 1 of your checks is at so 1 of your checks is 3,500 after taxes. Right? Then the next 1
[contact]: Right.
[handling agent]: is 3,500 plus 1000, the commission?
[contact]: No. No. No. No. No.
[contact]: Because there's 3,500 after taxes. And so I just say 40 just include the commission with the employment check. So make that 4,500.
[handling agent]: Okay.
[contact]: Okay? Include that. Just include that as employment w 24500. And
[handling agent]: Okay.
[contact]: then $252,500 for the Social Security.
[handling agent]: Got it. So we're looking at about $77,000 a month after taxes.
[contact]: Yes.
[handling agent]: Gotcha. Okay. Alright. Alright, Albert. Give me 1 second here.
[contact]: Mhmm.
[handling agent]: Man, speaking of computer problems, Equifax has just been slow all day today. Alright.
[contact]: Happens like that.
[handling agent]: Alright. Let's go ahead and Okay. Alright. Alright. So I'm gonna send you a do I have your permission to do that soft credit pull?
[contact]: Yeah. Go ahead.
[handling agent]: Alright. Thank you. Alright, Albert. I'm a send you a quick snapshot of what I see here. Just do me a favor and just verify if this is correct. Okay?
[contact]: Okay. Got it.
[handling agent]: Alright. You should get a text from me first, basically, asking making sure we can text each other. So it should be coming over right now. It's gonna say just making sure this is the right number before I send you anything. So once you get that, if you could just reply back with a yes or an okay for me, I'd appreciate it.
[handling agent]: And then I can send you the screenshot.
[contact]: Alright. I'm waiting for
[handling agent]: Okay.
[contact]: it.
[handling agent]: Did it come through yet?
[contact]: 83 you texting me
[handling agent]: I texted it to you.
[contact]: or emailing me?
[contact]: 832766880
[handling agent]: Yep. That's what I sent it to.
[contact]: 8.
[contact]: Yeah.
[handling agent]: It's okay. We can do an email. No problem. Alright. I've got, d a d sorry.
[handling agent]: Deanse1955@Gmail.
[contact]: Correct.
[handling agent]: Okay. Alright. That's, texted out right now. It's gonna be entitled profile.
[contact]: Thank you very much.
[contact]: You're welcome, baby. I
[contact]: like a lot of peanut butter.
[contact]: I put peanut butter on both sides. Okay.
[contact]: Okay. I put on the bed.
[contact]: Me I put on 1 side.
[contact]: Okay. It's my wife,
[handling agent]: That's awesome. Made
[contact]: David.
[contact]: Yep.
[handling agent]: you a sandwich?
[contact]: Yeah. Peanut butter
[handling agent]: There you go.
[contact]: and jelly sandwich. They they get yeah. This time of night, I don't wanna eat nothing
[handling agent]: Yep.
[contact]: heavy. Okay. I got David Hume,
[handling agent]: Yep.
[contact]: h u m e. Please verify logo.
[handling agent]: Yep.
[contact]: David. Okay. 1 moment. I got some stuff
[handling agent]: Yeah. If you just click on the attachment, it should bring up a snapshot from your from your Equifax. Just let me know if all that is accurate.
[contact]: here.
[contact]: It's not really accurate. I'm I'm with Americor. That's I'm with Americor. They're taking care of half of that's
[handling agent]: Okay.
[contact]: gone already, and I took care of the other half. So half of all that stuff is gone.
[handling agent]: Okay. When did you
[contact]: Yeah. More or less gone.
[handling agent]: start, yeah,
[handling agent]: when did you start the AmeriCorps program?
[contact]: I started with AmeriCorps about about 3 months ago, and they've been doing an excellent job. They've already
[handling agent]: Okay.
[contact]: taken care of 8 out 8 out of 10 customers already.
[handling agent]: Got it. Okay.
[contact]: And and I took and I've taken care of. Yeah. They got Capital 1. They got Synchrony taken care of. They got yeah.
[contact]: They got all that. Republic Republic is an old 1. That that's that's been gone a long time ago. I did that with
[handling agent]: Okay.
[contact]: Beyond. So all this stuff is crap. All this stuff is inaccurate.
[handling agent]: Okay.
[contact]: Fully inactive.
[handling agent]: Okay.
[contact]: Not up to date.
[handling agent]: Yeah. So I don't know if, like, they're just not reporting back to Equifax or maybe they haven't. Equifax hasn't dropped these off yet. Yeah.
[contact]: Yeah. Well, I can tell you where they're at. Yeah.
[handling agent]: So, yeah,
[handling agent]: so let me I'll I'll I'll
[contact]: Yeah. Yeah. Yeah.
[handling agent]: run I'll run for a loan anyway,
[contact]: Yeah.
[handling agent]: and we'll try to use your income. I will say this. You probably get a much better offer if if what was accurate was reflected on your on your credit pull. Because what
[contact]: Yeah. It's not a good it's not a good credit pull
[handling agent]: this
[handling agent]: yeah. Because, yeah, because with because AmeriCorps does a really good job. I I know them very well. But until the it's up to the creditors once they're paid off. It's up to the creditors for them to notify that your account is satisfied. So that can drag a little bit.
[contact]: right there. Yeah.
[handling agent]: That can take several months after debt is settled. So sometimes it's it's best to call up the actual, the company and be like, hey. Your debt's been satisfied. Can you can you get off my credit report right now? Because you're you're you're you're messing it up.
[handling agent]: And a lot of times, they'll do that, but, they're just not that quick sometimes to drop it off even when the account's been fully satisfied under the current terms you're under that you got with AmeriCorps. But, I mean, we can run something right now. It's no harm in doing it. I'm just saying it's gonna be much better if once these things clear out.
[contact]: Mhmm.
[handling agent]: Okay. Alright. Okay. So other tradelines, I see you currently have a mortgage. Looks like it's coming in right around about 1,200 a month.
[contact]: 12 50. Yep.
[handling agent]: Okay. And then automobile, about $6.92, and then another automobile, about $5.00 6. Okay.
[contact]: It's correct.
[handling agent]: Alright, Albert. Give me 1 second here. And this final this regional finance,
[contact]: Take your time.
[handling agent]: what what is that secured against?
[contact]: I'm gonna go to the bathroom.
[contact]: Need your financial security against the TVs, microwaves,
[handling agent]: Household items.
[contact]: furniture,
[handling agent]: Okay.
[contact]: you know, grand pianos
[handling agent]: Gotcha.
[contact]: or whatever I might have in the
[handling agent]: Okay.
[contact]: in the house. Yep.
[handling agent]: Perfect.
[contact]: And I'm already taking care of Synchrony. I mean, Regional Finance. I'm already in
[handling agent]: Okay.
[contact]: a settlement with
[handling agent]: Okay. Alright. Let me put
[contact]: them already.
[contact]: Yeah.
[handling agent]: notes in here that you are currently in settlements with all these accounts. Maybe that'll help.
[contact]: Correct.
[handling agent]: Yeah.
[contact]: Yep. Except for Citibank. Citibank, I'm just keeping that open.
[handling agent]: Okay.
[contact]: Citibank Home Depot, Citibank what's it called? Credit card, gas
[handling agent]: Yep.
[contact]: card. Yeah. That that's what
[handling agent]: Okay.
[contact]: they're still. And that's
[handling agent]: Gotcha. Okay.
[contact]: it.
[contact]: I'm sending back credit card. But that's the only ones that they opened. The rest of them have been settled
[handling agent]: Okay.
[contact]: or have been being
[handling agent]: Got it. Okay, Albert. Give me a
[contact]: processed.
[contact]: But they don't they don't
[handling agent]: minute or 2, and and
[handling agent]: I'll be right back. Okay?
[contact]: show it.
[contact]: No problem, mister Kim.
[handling agent]: Thank you.
[contact]: Hey, guys. It's Megan, lender rent finder. I've been able to do
[contact]: a little review on Penny Financial. So here's the reality upfront. Penny isn't actually a lender. It's a loan connection service. It claims to offer personal loans and debt consolidation loans up to 100,000 with rates starting
[handling agent]: Alright, Albert. Go
[contact]: at 5 point 9
[handling agent]: ahead and, go to your email. There should be an email in there right now that says link, and there's a actual link in there. Go ahead and click on that
[contact]: percent.
[contact]: Yeah.
[handling agent]: link, and then we'll see if anything came back.
[contact]: Hold on. Let me go through. Let me go go there. Okay. Yeah.
[handling agent]: Okay.
[handling agent]: Yep.
[contact]: It says link.
[handling agent]: So your soft your soft pull and your
[contact]: And
[contact]: what I do?
[handling agent]: income, we're gonna try and use, the income to offset some of the credit challenges on the credit report. So
[contact]: Okay.
[handling agent]: go ahead and click that
[contact]: So what do you want me to do?
[handling agent]: link and then type in last 4 of your social, and then click see my offers. And if any offers came back, it'll let you know in about 30 seconds or so.
[contact]: Hit the link?
[contact]: Okay. Looks like I
[handling agent]: Okay.
[contact]: failed,
[handling agent]: Yeah. I would I would
[contact]: but
[contact]: but that's fine.
[handling agent]: call you know, this is my advice. You can take it or leave it. I would I would call AmeriCorps and ask them what's the best way for these accounts that you settled for them to come off my credit report so I can be able to start recovering my score.
[contact]: You're welcome.
[handling agent]: They might be able to help you with that.
[contact]: Okay. Well,
[handling agent]: Okay. You're welcome, Albert.
[contact]: thank you for all your help.
[handling agent]: You too. Bye
[contact]: Yeah. You have a good evening. Okay? Take care, sir. Bye.
[handling agent]: bye.
END OF TRANSCRIPT`

const CALL_PAYLOAD = {
  call_id: "SMOKE_WT7882b5702ef52891e771147edc5987dd",
  agent_id: "dhume@trypennie.com",
  agent_email: "dhume@trypennie.com",
  contact_phone: "+18327668808",
  recording_link:
    "https://api.twilio.com/2010-04-01/Accounts/ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/Recordings/REXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.mp3",
  call_summary:
    "The call resulted in a discussion about Albert's financial situation and his interest in obtaining a loan.",
  transcript_url:
    "https://app.regalvoice.com/transcripts/WT7882b5702ef52891e771147edc5987dd/RE3fefa7c46924117ee5f429d09f0c319d/+18327668808",
  sfdc_lead_id: "00QUl00000PH6qlMAD",
  transcript: {
    transcript: TRANSCRIPT,
    metadata: {
      duration: 1017,
      timestamp: "2026-02-20T01:39:57Z",
      talk_time: 955,
      disposition: "1.5 - Not Interested > END CAMPAIGNS",
      campaign_name: "Cal.com Meeting",
    },
  },
}

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------
interface TestResult {
  name: string
  passed: boolean
  timeMs: number
  violation?: string
  error?: string
}

const MODULES = ["budget-inputs", "warm-transfer", "litigation-check"] as const

async function runTest(
  name: string,
  fn: () => Promise<{ violation?: string }>,
): Promise<TestResult> {
  const start = Date.now()
  try {
    const { violation } = await fn()
    return { name, passed: true, timeMs: Date.now() - start, violation }
  } catch (err) {
    return {
      name,
      passed: false,
      timeMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function testHealthRoot(): Promise<{ violation?: string }> {
  const res = await fetch(`${BASE_URL}/`)
  if (!res.ok) throw new Error(`Status ${res.status}`)
  const body = (await res.json()) as Record<string, unknown>
  if (body.service !== "eavesly") throw new Error(`Unexpected service: ${body.service}`)
  if (body.status !== "ok") throw new Error(`Unexpected status: ${body.status}`)
  return {}
}

async function testHealthCheck(): Promise<{ violation?: string }> {
  const res = await fetch(`${BASE_URL}/health`)
  if (!res.ok) throw new Error(`Status ${res.status}`)
  const body = (await res.json()) as Record<string, unknown>
  if (body.status !== "healthy") throw new Error(`Unexpected status: ${body.status}`)
  if (!(body.checks as Record<string, unknown>)?.database)
    throw new Error("Missing checks.database")
  return {}
}

async function testModule(
  module: string,
): Promise<{ violation?: string }> {
  const res = await fetch(`${BASE_URL}/api/v1/evaluate/${module}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(CALL_PAYLOAD),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Status ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as Record<string, unknown>

  // Validate common response fields
  const required = [
    "call_id",
    "module",
    "correlation_id",
    "timestamp",
    "processing_time_ms",
    "result",
  ]
  for (const field of required) {
    if (!(field in body)) throw new Error(`Missing field: ${field}`)
  }
  if (typeof body.has_violation !== "boolean")
    throw new Error("has_violation is not boolean")
  if (typeof body.alert_dispatched !== "boolean")
    throw new Error("alert_dispatched is not boolean")

  return {
    violation: body.has_violation
      ? (body.violation_type as string) ?? "yes"
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------
const RESET = "\x1b[0m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const DIM = "\x1b[2m"

function printSummary(results: TestResult[]) {
  const nameW = 28
  const statusW = 8
  const timeW = 10
  const violW = 16

  const hr = `${"─".repeat(nameW)}┼${"─".repeat(statusW)}┼${"─".repeat(timeW)}┼${"─".repeat(violW)}`
  const header = `${CYAN}${"Endpoint".padEnd(nameW)}│${"Status".padEnd(statusW)}│${"Time(ms)".padEnd(timeW)}│${"Violation".padEnd(violW)}${RESET}`

  console.log()
  console.log(header)
  console.log(hr)

  for (const r of results) {
    const status = r.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
    const time = String(r.timeMs)
    const viol = r.violation ?? (r.error ? `${RED}err${RESET}` : `${DIM}-${RESET}`)
    // Pad accounting for ANSI escape sequences
    const statusPad = r.passed
      ? status + " ".repeat(statusW - 4)
      : status + " ".repeat(statusW - 4)
    const violPad = r.violation
      ? viol.padEnd(violW)
      : viol + " ".repeat(Math.max(0, violW - (r.error ? 3 : 1)))

    console.log(
      `${r.name.padEnd(nameW)}│${statusPad}│${time.padEnd(timeW)}│${violPad}`,
    )
  }

  console.log(hr)

  if (results.some((r) => !r.passed)) {
    console.log()
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`${RED}FAIL${RESET} ${r.name}: ${r.error}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nSmoke testing ${CYAN}${BASE_URL}${RESET}\n`)

  const results: TestResult[] = []

  // 1. Health checks (run in parallel)
  const [root, health] = await Promise.all([
    runTest("GET /", testHealthRoot),
    runTest("GET /health", testHealthCheck),
  ])
  results.push(root, health)

  // 2. Module evaluations (run sequentially to avoid rate limits)
  for (const mod of MODULES) {
    const result = await runTest(mod, () => testModule(mod))
    results.push(result)
  }

  printSummary(results)

  const allPassed = results.every((r) => r.passed)
  console.log(
    allPassed
      ? `\n${GREEN}All ${results.length} checks passed.${RESET}\n`
      : `\n${RED}${results.filter((r) => !r.passed).length} of ${results.length} checks failed.${RESET}\n`,
  )
  process.exit(allPassed ? 0 : 1)
}

main()
