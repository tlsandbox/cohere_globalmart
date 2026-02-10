# RetailNext Onsite (20-Minute Presentation + Demo)

## 1) Time Plan
- 0:00-2:00: Business context and pain points
- 2:00-6:00: OpenAI platform and solution overview
- 6:00-11:00: Architecture + process flow
- 11:00-17:00: Live demo (text, image, check-match)
- 17:00-20:00: Business value, roadmap, next steps

## 2) Slide-by-Slide Talk Track
- Slide 1: Position the objective: reduce style-findability friction.
- Slide 2: Describe the three discovery-call assumptions (findability, intent gap, store burden).
- Slide 3: Show what is implemented now and call out the added AI feature.
- Slide 4: Map each model/API to a specific business function.
- Slide 5: Walk architecture left-to-right.
- Slide 6: Explain request lifecycle from intent to persisted result.
- Slide 7: Present pilot KPIs as targets and how each is measured.
- Slide 8: Show 12-week de-risked rollout plan.
- Slide 9: Explain why OpenAI platform fit matters for iteration speed and governance.
- Slide 10: Confirm pilot decision points and ask for technical deep dive.

## 3) Q&A Prompts to Prepare For
- Why this model mix (`gpt-4o-mini` + `text-embedding-3-large`)?
- How do you prevent hallucinated recommendations?
- How would you integrate real-time inventory/availability next?
- What are fallback behaviors when OpenAI API is unavailable?
- How do you measure true business impact in pilot vs baseline search?

## 4) Demo Path (Fast)
1. Home page -> enter natural-language query.
2. Personalized page -> highlight ranked recommendations.
3. Click "Check Your Match" -> show verdict/rationale/confidence.
4. Upload image -> show multimodal retrieval flow.
5. Close with KPI instrumentation and roadmap.
