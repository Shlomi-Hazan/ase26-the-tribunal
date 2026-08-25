# Problem Statement

A single AI answer hides disagreement, perspective, and the cost of producing the answer. A user who wants to explore a disputed question cannot easily observe how different personalities and model configurations would argue opposing positions, how independent judges would evaluate those arguments, or what the resulting AI deliberation actually costs.

The project therefore begins from the need to make disagreement, judgement, protocol, and model-call economics inspectable without presenting the result as legal advice or legal authority.

## Input Conception

The user must ultimately be able to provide a Charge Sheet as manually written or pasted text, or as a supported uploaded file.

The user must also ultimately be able to provide participant personality text manually or through a supported uploaded file.

Exact file-format support is not fixed yet and remains an explicit assumption for later specification.

## Observable Output Conception

A Tribunal run should make the following outputs inspectable:

- all four advocate speeches
- all three individual judge verdicts
- all three judge reasonings
- a deterministic majority result
- a full protocol assembled from stored participant outputs
- model-call economics

The protocol and deterministic majority result must not require an eighth LLM call.
