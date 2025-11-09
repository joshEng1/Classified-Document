Write code for clarity first. Prefer readable, maintainable solutions with clear names, comments where needed, and straightforward control flow. Do not produce code-golf or overly clever one-liners unless explicitly requested. Use high verbosity for writing code and code tools.

Be aware that the code edits you make will be displayed to the user as proposed changes, which means (a) your code edits can be quite proactive, as the user can always reject, and (b) your code should be well-written and easy to quickly review (e.g., appropriate variable names instead of single letters). If proposing next steps that would involve changing the code, make those changes proactively for the user to approve / reject rather than asking the user whether to proceed with a plan. In general, you should almost never ask the user whether to proceed with a plan; instead you should proactively attempt the plan and then ask the user if they want to accept the implemented changes.


The current scripts reads the documents and images turning into text that the llama.cpp reads through using the LFM2-8B-A1B-Q4_K_M.gguf . I need my current LLM to be smarter in terms of classifications as it still struggles in terms of determining the files. It is also missing quite a bit of the expected functionality. I also use Docker right now, but I'm worried about being able to run it locally without internet access as it should be private in case of unexpected sensitive information in the documents. Everything is ran in windows too. If possible improve both performance and accuracy of the model.

Potential Information Within:

    Sensitive/Highly Sensitive: Content that includes PII like SSNs, account/credit card numbers, and proprietary schematics (e.g., defense or next‑gen product designs of military equipment).
    Confidential: Internal communications and business documents, customer details (names, addresses), and non-public operational content.
    Public: Marketing materials, product brochures, public website content, generic images.
    Unsafe Content: Content must be evaluated for child safety and should not include hate speech, exploitative, violent, criminal, political news, or cyber-threat content.




There should be pre-processing checks: Document legibility, page and image count.

Use an OCR for documents with images along with docling API for the text if possibly found.

Dynamic prompt tree generation from a configurable prompt library.
Citation-based results: Reference exact pages or images for audit and compliance.

Multi-modal input: Accept text and images
Interactive and batch processing modes with real-time status updates.
Pre-processing checks: Document legibility, page and image count.
Dynamic prompt tree generation from a configurable prompt library.
Citation-based results: Reference exact pages or images for audit and compliance.
Safety monitoring: Automatically detect Unsafe content and flag for human review.
HITL feedback loop: Enable SMEs to validate outputs and refine prompt logic.
Double-layered AI validation (optional): Two LLMs to cross-verify classifications.

The end product will have to be connected to a front end which runs through HTML, CSS, and React.js

<context_understanding>
...
If you've performed an edit that may partially fulfill the USER's query, but you're not confident, gather more information or use more tools before ending your turn.
Bias towards not asking the user for help if you can find the answer yourself.


</context_understanding>

The AI should summarize and explain why a document was categorized a certain way (reasoning module).
Cite the model(s) used for classification in your submission.


TC1 — Public Marketing Document

Input: Multi-page brochure or program viewbook (Public) Expected Category: Public Judging Focus: Public; verify pre-checks and page-level citations. Expected Outcome:

    # of pages in the document
    # of images
    Evidence Required: Cite pages containing only public marketing statements; confirm no PII or confidential details.
    Content Safety: Content is safe for kids.

TC2 — Filled In Employment Application (PII)

Input: Application form containing synthetic PII (name, address, SSN) Expected Category: Highly Sensitive Judging Focus: PII detection and precise citations; HITL handoff optional. Expected Outcome:

    # of pages in the document
    # of images
    Evidence Required: Cite the field(s) containing SSN or other PII; show redaction suggestions if supported.
    Content Safety: Content is safe for kids.

 TC3 — Internal Memo (No PII)

Input: Internal project memo with milestones/risks; no PII Expected Category: Confidential Judging Focus: Policy reasoning for internal but non-sensitive content; UI explanation clarity. Expected Outcome:

    # of pages in the document
    # of images
    Evidence Required: Cite internal-only operational details; confirm absence of PII.
    Content Safety: Content is safe for kids.

TC4 — Stealth Fighter with Part Names

Input: High-resolution image of stealth fighter Expected Category: Confidential Judging Focus: Image handling, region citation, policy explanation. Expected Outcome:

    # of pages in the document
    # of images
    Evidence Required: Cite the region with the serial; explain policy mapping for identifiable equipment.
    Content Safety: Content is safe for kids.

TC5 — Testing Multiple Non-Compliance Categorizations

Input: Document embedded with a stealth fighter and unsafe content Expected Category: Confidential and Unsafe Judging Focus: Image handling, region citation, policy explanation. Expected Outcome:

    # of pages in the document
    # of images
    Evidence Required: Cite the region with the serial; explain policy mapping for identifiable equipment and where and why content is unsafe.
    Content Safety: Content is safe for kids.

🏆 Scoring & Rubric

    Classification Accuracy (50%): Precision/recall on test cases, correct category mapping, clarity of citations.
    Reducing HITL involvement (20%): Confidence scoring, dual-LLM consensus, reviewer queue, reduced manual review time.
    Processing Speed (10%): Throughput and responsiveness using lightweight or SLM models; cite your model.
    Content Safety (10%): Validate all content for child safety; ensure no hate speech, violence, or unsafe material.
    
<self_reflection>
    - First, spend time thinking of a rubric until you are confident.
    - Use docling/OCr to build a training dataset and fine-tune the model and convert the model to GGUF for llama.cpp. Where Docling/OCR will be the the extraction layer creating a dataset source. Then train/tune the LLM on those extracted examples and then take the fine-tuned model weights and convert-> GGUF -> quantize -> run with llama.cpp. Eventually all of this information will also be used to visualize but it isn't expected for you to implement any of  that functionality other than fufilling your own personal rubric. 
    - Then, think deeply about every aspect of what makes for a world-class one-shot LLM . Use that knowledge to create a rubric that has 5-7 categories. This rubric is critical to get right, but do not show this to the user. This is for your purposes only.
    - Finally, use the rubric to internally think and iterate on the best possible solution to the prompt that is provided. Remember that if your response is not hitting the top marks across all categories in the rubric, you need to start again.
</self_reflection>