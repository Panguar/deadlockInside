# Codex Agent Rules for Git and Development
# Context Optimization Protocol: Three-Stage Lifecycle (OpenAI Stack)

## CONTEXT CACHING & EFFICIENCY RULES
To maximize OpenAI Context Caching, all API requests must strictly follow this structural order:
1. Static System Prompts (this file)
2. Project Structure & Global Metadata
3. Dynamic Payload (Task descriptions, local diffs, or error logs)

---

## STAGE 1: Sol 6.1 (Planner / Architect)
- **Model Target:** `gpt-6.1-sol`
- **Configuration:** `model_reasoning_effort: high`, `temperature: 0.2`
- **Context Access:** Global user requirements, project file tree, high-level architecture documentation.
- **Action Workflow:**
  1. Analyzes the global user request against the existing codebase structure.
  2. Decomposes the goal into sequential, isolated, atomic steps.
  3. Generates a clear Technical Specification (Task) for the coder.
- **Strict Constraints:** 
  - NEVER write or generate production code yourself.
  - NEVER read full source files longer than 50 lines. Use the `Run_Luna_Coder` tool for any code modifications.

## STAGE 2: Luna (Executor / Coder)
- **Model Target:** `gpt-6-luna`
- **Configuration:** `temperature: 0.0` (Strictly deterministic mode)
- **Context Access:** Isolated sub-thread sandbox. Sees ONLY the specific target file and the atomic task from Stage 1.
- **Action Workflow:**
  1. Modifies the requested code according to the specification.
  2. Outputs changes strictly using `SEARCH/REPLACE` diff blocks.
- **Token Saving Constraints:**
  - Forbidden to write introductory or explanatory text (e.g., "Sure, here is the code").
  - Do not use markdown wrappers around the diff blocks except for standard code blocks.
  - Output format must strictly match:
    ```text
    <<<<<<< SEARCH
    [exact original code snippet]
    =======
    [modified code snippet]
    >>>>>>> REPLACE
    ```

## STAGE 3: Sol 6.1 (Reviewer / Controller)
- **Model Target:** `gpt-6.1-sol`
- **Configuration:** `model_reasoning_effort: high`, `temperature: 0.1`
- **Context Access:** Isolated review sub-thread. Sees ONLY the atomic task from Stage 1 and the generated `SEARCH/REPLACE` block from Stage 2. Does NOT read the entire file to save tokens.
- **Action Workflow:**
  1. **Automated Check:** Prior to logical analysis, executes local testing and linting commands (e.g., `npm test`, `pytest`, `eslint`). If any test fails, automatically triggers a **REJECT**.
  2. **Logical Analysis:** Evaluates whether the diff accurately satisfies the Task without introducing security vulnerabilities or breaking architectural design.
- **Outputs & Decisions:**
  - **APPROVE:** If tests pass and code is correct, outputs exactly one word: `APPROVE`. The diff is applied, and the task proceeds to the Git Module.
  - **REJECT:** If bugs are found or tests fail, outputs exactly: `REJECT\nError: [short syntax/test error log or line description]`. Clears the sub-thread context and sends the error back to Stage 2.

---

## 4. Commit Granularity and Staging
- **Atomic Commits:** Break down changes into small, logical, and atomic units. One successfully approved task from Stage 3 equals exactly one commit. Do not bundle unrelated features, fixes, or refactoring into a single commit.
- **Selective Staging:** Check modified files first and stage only the specific files relevant to the current atomic change.
- **Verification:** Always run `git diff --cached` before generating a commit message to ensure no unintended changes are staged.

## 5. Commit Message Formatting
- **Specification:** Strictly follow the **Conventional Commits** specification.
- **Allowed Types:** Use only the following types: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`.
- **Structure:** 
  - **Header:** Write in lowercase, use the **imperative mood** (e.g., `feat: add user login`). Keep the header under **50 characters**.
  - **Body & Footer (Optional):** Use if a detailed explanation or issue reference (e.g., `Fixes #123`) is required.
- **Language:** Always write commit messages in English.

## 6. Workflow and Direct Pushing
- **Target Branch:** You are explicitly allowed and expected to work directly on the **`main`** branch.
- **Automated Pushing:** After making a successful local commit on the `main` branch, you are permitted to automatically execute `git push origin main`.
- **Pre-commit Checks:** Ensure all local tests and linters pass successfully before committing and pushing directly to `main`.
- **Conflicts:** If a push to `main` fails due to non-fast-forward updates, run `git pull --rebase origin main` to resolve conflicts before attempting to push again.
