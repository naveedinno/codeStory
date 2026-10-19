// Builds a throwaway git repo with a realistic multi-file change + a tour, then
// opens the codeStory review page on it. Run with: npm run demo
// Set CODESTORY_DEMO_NO_SERVE=1 to build the repo without launching the server.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { captureStorySnapshot } from '../dist/story-drift.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = join(ROOT, 'dist', 'app-server.js');
const DEMO = process.env.CODESTORY_DEMO_DIR || join(tmpdir(), 'codestory-demo');

// ---------------------------------------------------------------------------
// File contents. Authored so line numbers match the tour ranges exactly.
// (No backticks or ${} inside — they'd clash with these template literals.)
// ---------------------------------------------------------------------------

const BASE_API = `import { placeOrder } from './orders.js';
import { getCustomer } from './db.js';

const MONTHLY_CAP = 1000;

// POST /orders — create an order for a customer.
export async function createOrder(req) {
  const { customerId, amount, items } = req.body;

  const customer = await getCustomer(customerId);
  const spent = customer.monthlySpend || 0;
  const remaining = MONTHLY_CAP - spent;
  if (amount >= remaining) {
    return { status: 402, error: 'over the limit, ' + remaining + ' remaining' };
  }

  const order = await placeOrder(customerId, amount, items);
  return { status: 201, order };
}
`;

const NEW_API = `import { placeOrder } from './orders.js';
import { checkSpendingLimit } from './limits.js';

// POST /orders — create an order for a customer.
export async function createOrder(req) {
  const { customerId, amount, items } = req.body;

  // Reject the order if it would blow the customer's monthly cap.
  const limit = await checkSpendingLimit(customerId, amount);
  if (!limit.ok) {
    return { status: 402, error: 'over the limit, ' + limit.remaining + ' remaining' };
  }

  const order = await placeOrder(customerId, amount, items);
  return { status: 201, order };
}
`;

const BASE_ORDERS = `const orders = [];

function recordSpend(customerId, amount) {
  // demo persistence — a real impl would update the customer's monthlySpend
  console.log('spend', customerId, '+=', amount);
}

export async function placeOrder(customerId, amount, items) {
  const order = { id: orders.length + 1, customerId, amount, items };
  orders.push(order);
  return order;
}
`;

const NEW_ORDERS = `const orders = []; // FIXME: persist these somewhere real

export async function placeOrder(customerId, amount, items) {
  const order = { id: orders.length + 1, customerId, amount, items };
  orders.push(order);
  recordSpend(customerId, amount); // track spend toward the monthly cap
  return order;
}

function recordSpend(customerId, amount) {
  // demo persistence — a real impl would update the customer's monthlySpend
  console.log('spend', customerId, '+=', amount);
}
`;

const DB = `// In-memory customer store (demo only).
const customers = {
  c1: { id: 'c1', name: 'Acme', monthlySpend: 850 },
};

export async function getCustomer(id) {
  return customers[id];
}
`;

const NEW_LIMITS = `import { getCustomer } from './db.js';

const MONTHLY_CAP = 1000;

// How much more this customer can spend this month.
export async function checkSpendingLimit(customerId, amount) {
  const customer = await getCustomer(customerId);
  const spent = customer.monthlySpend || 0;
  const remaining = MONTHLY_CAP - spent;
  return { ok: amount < remaining, remaining };
}
`;

const NEW_TEST = `import { checkSpendingLimit } from '../src/limits.js';

test('rejects an order over the monthly cap', async () => {
  const r = await checkSpendingLimit('c1', 500);
  // c1 has spent 850 of 1000, so only 150 remains — 500 must be rejected.
  expect(r.ok).toBe(false);
});
`;

const BASE_PIPELINE = `export function prepare(input) {
  const authorized = authorize(input);
  return normalize(authorized);
}

function authorize(input) {
  if (!input) throw new Error('missing input');
  return input;
}

function recordMetric(name) {
  console.log('metric', name);
}

function enrich(input) {
  recordMetric('prepared');
  return { value: input };
}

function normalize(input) {
  return input.trim().toLowerCase();
}
`;

const NEW_PIPELINE = `export function prepare(input) {
  const normalized = normalize(input);
  return authorize(normalized);
}

function normalize(input) {
  return input.trim().toLowerCase();
}

function recordMetric(name) {
  console.log('metric', name);
}

function enrich(input) {
  recordMetric('prepared');
  return { value: input };
}

function authorize(input) {
  if (!input) throw new Error('missing input');
  return input;
}
`;

const BASE_RECEIPT = `export function formatReceipt(order) {
  const total = order.items.reduce((sum, item) => sum + item.price, 0);
  return order.id + ': ' + total;
}
`;

const NEW_RECEIPT = `export function formatReceipt(order) {
  const label = 'Order ' + order.id;
  const total = order.items.reduce((sum, item) => sum + item.price, 0);
  return label + ': ' + total;
}
`;

const TOUR = `{
  "version": 3,
  "mode": "guided",
  "title": "Diff annotations in one spending-limit review",
  "summary": "Start with a local path callout, read each cross-file relationship as a left-to-right pane pair, then inspect a consequence, a reordered two-hunk crossing, and a deliberately unlabeled move that leaves the diff plain.",
  "intent": {
    "goal": "Give the monthly-cap decision one reusable owner while demonstrating semantic annotations on realistic code.",
    "design": "The existing POST /orders path still owns placement; each primary cross-file relationship gets its own two-pane step, hidden facts become path or consequence callouts, reordered runs cross in the gutter, and one unlabeled move proves plain diffs stay plain.",
    "sources": ["commit refactor: extract monthly spending policy"]
  },
  "base": "main",
  "steps": [
    {
      "id": "s1", "order": 1, "title": "POST /orders keeps ownership and gains one pre-placement decision",
      "file": "src/api.ts", "range": [1, 16], "viewport": [1, 16],
      "highlights": [[4, 6], [8, 12], [14, 15]], "kind": "changed",
      "moves": [
        { "id": "gate-predicate", "kind": "condition-changed", "before": { "file": "src/api.ts", "range": [13, 13] }, "after": { "file": "src/api.ts", "range": [10, 10] }, "label": "now delegated", "hidden": { "as": "path", "tag": "success is fallthrough", "what": "allowed orders reach <code>placeOrder()</code> without an else branch" } }
      ],
      "why": "I keep the existing order boundary and stop over-cap requests before placeOrder() can mutate anything.",
      "beats": [
        { "text": "The client reaches <code>createOrder()</code> through POST /orders; this handler owns the request boundary.", "highlights": [[4, 6]] },
        { "text": "The new decision reads the limit and returns before placement when the request would cross it.", "highlights": [[8, 12]] },
        { "text": "The accepted path still reaches the same placeOrder() call and 201 response.", "highlights": [[14, 15]] }
      ],
      "calls": ["s2"], "tags": ["entrypoint"]
    },
    {
      "id": "c1", "order": 2, "title": "The limit is a decision over derived budget, not a stored flag",
      "kind": "concept",
      "body": "<h2>Three values form the policy</h2><p>The store owns <strong>spent so far</strong>. Configuration supplies the <strong>monthly cap</strong>. The helper derives <strong>remaining budget</strong>, then compares the incoming order amount with that result.</p><table><caption>Each value has a different owner and lifetime, which is why nothing stores an over-limit flag.</caption><thead><tr><th scope='col'>Value</th><th scope='col'>Owner</th><th scope='col'>Lifetime</th></tr></thead><tbody><tr><td><code class='ds-slot'>monthlySpend</code></td><td>the store</td><td>persisted state</td></tr><tr><td><code class='ds-slot'>MONTHLY_CAP</code></td><td>configuration</td><td>policy</td></tr><tr><td><code class='ds-val'>remaining</code></td><td>the helper</td><td>derived per call</td></tr></tbody></table><blockquote>Review the comparison as a business boundary: an amount equal to the remaining budget should either be deliberately accepted or deliberately rejected.</blockquote>",
      "preparesFor": ["s2", "s3", "s4"],
      "diagram": {
        "type": "mermaid",
        "source": "flowchart LR\\n  Stored[Spent so far] --> Remaining[Remaining budget]\\n  Cap[Monthly cap] --> Remaining\\n  Remaining --> Gate{Order fits?}\\n  Amount[Order amount] --> Gate",
        "caption": "Stored spend and the cap produce a remaining budget; the incoming amount is compared with that derived value."
      },
      "tags": ["mental-model", "policy"]
    },
    {
      "id": "s2", "order": 3, "title": "checkSpendingLimit() turns stored spend into the gate result",
      "file": "src/limits.ts", "range": [1, 11], "viewport": [1, 11],
      "highlights": [[1, 5], [7, 10]], "kind": "new-file",
      "moves": [
        { "id": "stored-spend-source", "kind": "flow", "before": { "file": "src/db.ts", "range": [2, 4] }, "after": { "file": "src/limits.ts", "range": [7, 9] }, "label": "reads stored spend" }
      ],
      "why": "I isolate the cap math here, with the exact-equality comparison as the review hinge.",
      "beats": [
        { "text": "<code>createOrder()</code> calls <code>checkSpendingLimit()</code> before placement; this helper owns the monthly cap.", "highlights": [[1, 5]] },
        { "text": "It derives remaining budget from stored spend; pause on amount < remaining because equal-to-remaining is the boundary risk.", "highlights": [[7, 10]] }
      ],
      "calls": ["s3"], "returnsTo": "s1", "tags": ["core"]
    },
    {
      "id": "s3", "order": 4, "title": "The inline API policy becomes the reusable limit helper",
      "file": "src/limits.ts", "range": [6, 10], "viewport": [1, 11],
      "highlights": [[6, 10]], "kind": "new-file",
      "moves": [
        { "id": "extract-limit", "kind": "extracted", "before": { "file": "src/api.ts", "range": [10, 15] }, "after": { "file": "src/limits.ts", "range": [6, 10] }, "label": "moved out" }
      ],
      "why": "I show the extraction separately so its API source and helper destination are both readable instead of competing with the stored-data relationship.",
      "beats": [
        { "text": "<code>checkSpendingLimit()</code> is reached from <code>createOrder()</code>; the left pane keeps the old inline calculation visible.", "highlights": [[6, 8]] },
        { "text": "The right pane shows the same decision in its reusable helper, while the API keeps only the call site.", "highlights": [[9, 10]] }
      ],
      "returnsTo": "s2", "tags": ["context"]
    },
    {
      "id": "s4", "order": 5, "title": "Accepted orders feed spend back into the placement path",
      "file": "src/orders.ts", "range": [1, 13], "viewport": [1, 13],
      "highlights": [[3, 6], [10, 13]], "kind": "changed",
      "moves": [
        { "id": "move-recorder", "kind": "moved", "before": { "file": "src/orders.ts", "range": [3, 6] }, "after": { "file": "src/orders.ts", "range": [10, 13] }, "label": "moved below", "hidden": { "as": "consequence", "tag": "spend is logged only", "what": "accepted orders log the amount; this demo does not persist a new budget" } }
      ],
      "why": "Back on the accepted path, I log the spend after storing the order; this demo does not update the next limit check.",
      "beats": [
        { "text": "<code>createOrder()</code> reaches <code>placeOrder()</code> after the gate passes; this function stores the accepted order.", "highlights": [[3, 5]] },
        { "text": "The new handoff records that accepted amount before the function returns.", "highlights": [[6, 6]] },
        { "text": "This demo helper is the downstream effect; its persistence limitation is deliberately visible here.", "highlights": [[10, 13]] }
      ],
      "returnsTo": "s1", "tags": ["core"]
    },
    {
      "id": "s5", "order": 6, "title": "Reordered pipeline stages cross between two rendered runs",
      "file": "src/pipeline.ts", "range": [1, 22], "viewport": [1, 22],
      "highlights": [[1, 4], [19, 22]], "kind": "changed",
      "moves": [
        { "id": "reorder-pipeline", "kind": "reordered", "before": { "file": "src/pipeline.ts", "range": [1, 22] }, "after": { "file": "src/pipeline.ts", "range": [1, 22] }, "label": "order reversed" }
      ],
      "why": "The two changed runs swap semantic order, so their gutter arrows cross deliberately instead of pretending the mapping stayed linear.",
      "beats": [
        { "text": "The pipeline caller enters <code>prepare()</code>; it now normalizes before authorization, changing what the guard receives.", "highlights": [[1, 4]] },
        { "text": "The helper definitions move with that order; the crossed arrows make the reversal explicit across the hunk gap.", "highlights": [[19, 22]] }
      ],
      "tags": ["annotation-showcase"]
    },
    {
      "id": "s6", "order": 7, "title": "An unlabeled move leaves the receipt diff completely plain",
      "file": "src/receipt.ts", "range": [1, 5], "viewport": [1, 5],
      "highlights": [[1, 5]], "kind": "changed",
      "moves": [
        { "id": "plain-total-move", "kind": "moved", "before": { "file": "src/receipt.ts", "range": [2, 2] }, "after": { "file": "src/receipt.ts", "range": [3, 3] } }
      ],
      "why": "Both panes already teach this one-line move, so the story authors no label or hidden fact and the renderer adds no annotation ink.",
      "beats": [
        { "text": "The receipt caller enters <code>formatReceipt()</code> after placement; its total calculation shifts by one line.", "highlights": [[1, 5]] }
      ],
      "tags": ["annotation-showcase"]
    },
    {
      "id": "s7", "order": 8, "title": "Rejection proof leaves the exact boundary exposed",
      "file": "test/limits.test.ts", "range": [1, 7], "viewport": [1, 7],
      "highlights": [[1, 7]], "kind": "new-file",
      "why": "The test proves an over-cap request fails, while leaving equal-to-remaining as the missing case to review.",
      "beats": [
        { "text": "The test runner reaches <code>checkSpendingLimit()</code> through the over-cap test with a customer who only has 150 left.", "highlights": [[1, 3]] },
        { "text": "It pins the over-cap rejection but does not settle the exact-equality behavior flagged above.", "highlights": [[4, 7]] }
      ],
      "tags": ["test"]
    }
  ]
}
`;

const COMMENTS = `[
  { "id": "c_demo1", "step": "s2", "file": "src/limits.ts", "line": 10, "side": "right", "type": "change", "selectedText": "  return { ok: amount < remaining, remaining };", "selection": { "startLine": 10, "endLine": 10, "startColumn": 1, "endColumn": 48 }, "body": "Boundary bug? 'amount < remaining' rejects a spend that exactly equals the remaining budget. Should this be '<=' ?", "status": "open", "createdAt": "2026-06-14T12:00:00.000Z" },
  { "id": "c_demo2", "step": "s1", "file": "src/api.ts", "line": 11, "side": "right", "type": "question", "selectedText": "    return { status: 402, error: 'over the limit, ' + limit.remaining + ' remaining' };", "selection": { "startLine": 11, "endLine": 11, "startColumn": 1, "endColumn": 87 }, "body": "Is 402 the right status for over-limit, or should this be 403/429? What does the rest of the API use?", "status": "open", "createdAt": "2026-06-14T12:01:00.000Z" }
]
`;

// ---------------------------------------------------------------------------

function git(args) {
  execFileSync('git', args, { cwd: DEMO, stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitOut(args) {
  return execFileSync('git', args, { cwd: DEMO, encoding: 'utf8' }).trim();
}
function write(rel, content) {
  const p = join(DEMO, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

// reset + base commit (on main)
rmSync(DEMO, { recursive: true, force: true });
mkdirSync(DEMO, { recursive: true });
git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'demo@codestory']);
git(['config', 'user.name', 'codeStory demo']);
write('src/api.ts', BASE_API);
write('src/orders.ts', BASE_ORDERS);
write('src/db.ts', DB);
write('src/pipeline.ts', BASE_PIPELINE);
write('src/receipt.ts', BASE_RECEIPT);
git(['add', '-A']);
git(['commit', '-qm', 'base: orders service']);

// the change (on a feature branch)
git(['checkout', '-q', '-b', 'feat/spending-limit']);
write('src/api.ts', NEW_API);
write('src/limits.ts', NEW_LIMITS);
git(['add', '-A']);
git(['commit', '-qm', 'feat: extract the monthly spending decision']);

write('src/orders.ts', NEW_ORDERS);
write('src/pipeline.ts', NEW_PIPELINE);
write('src/receipt.ts', NEW_RECEIPT);
git(['add', '-A']);
git(['commit', '-qm', 'refactor: connect the supporting flow']);

write('test/limits.test.ts', NEW_TEST);
git(['add', '-A']);
git(['commit', '-qm', 'test: prove over-cap rejection']);

// the tour + a couple of pre-seeded comments
const story = JSON.parse(TOUR);
const landings = {
  s1: { symbol: 'createOrder()', role: { who: 'API client' }, when: 'POST /orders' },
  s2: { symbol: 'checkSpendingLimit()', calledBy: ['createOrder()'], when: 'before placing an order' },
  s3: { symbol: 'checkSpendingLimit()', calledBy: ['createOrder()'], when: 'the handler delegates its policy' },
  s4: { symbol: 'placeOrder()', calledBy: ['createOrder()'], when: 'after the spending gate accepts' },
  s5: { symbol: 'prepare()', role: { who: 'pipeline caller' }, when: 'preparing input' },
  s6: { symbol: 'formatReceipt()', role: { who: 'receipt caller' }, when: 'formatting a placed order' },
  s7: { symbol: 'checkSpendingLimit()', role: { who: 'test runner' }, when: 'running the over-cap rejection test' },
};
for (const step of story.steps) if (landings[step.id]) step.landing = landings[step.id];
story.hotspots = [
  { step: 's2', reason: 'The strict comparison rejects an amount exactly equal to the remaining budget; the test only exercises an over-cap amount.' },
  { step: 's4', reason: 'recordSpend() only logs the amount, so repeated accepted orders do not reduce the stored remaining budget.' },
];
story.verification = [{ check: 'git diff --check main...HEAD', result: 'not-run', detail: 'Checks patch whitespace; it does not execute the spending-policy test.' }];

const evolutionCommits = gitOut(['rev-list', '--first-parent', '--reverse', 'main..feat/spending-limit']).split('\n');
story.head = 'feat/spending-limit';
story.storyArc = {
  changeType: 'mixed',
  shape: 'entry-implementation',
  readingPath: 'request boundary -> shared policy -> downstream state -> proof',
};
story.evolution = {
  baseSha: gitOut(['rev-parse', 'main']),
  headSha: gitOut(['rev-parse', 'feat/spending-limit']),
  phases: [
    {
      title: 'Extract the decision',
      summary: 'The request boundary delegates the spending calculation to one reusable policy helper.',
      firstCommit: evolutionCommits[0],
      lastCommit: evolutionCommits[0],
      relatedSteps: ['s1', 's2'],
    },
    {
      title: 'Connect the supporting flow',
      summary: 'The accepted path records spend while the adjacent move examples complete the review surface.',
      firstCommit: evolutionCommits[1],
      lastCommit: evolutionCommits[1],
      relatedSteps: ['s4'],
    },
    {
      title: 'Pin the rejection case',
      summary: 'The final commit proves an over-cap order is rejected and leaves exact equality visible as a review question.',
      firstCommit: evolutionCommits[2],
      lastCommit: evolutionCommits[2],
      relatedSteps: ['s7'],
    },
  ],
};
story.storySnapshot = captureStorySnapshot({ repo: DEMO, base: story.base, head: story.head });
write('.codestory/story.json', `${JSON.stringify(story, null, 2)}\n`);
write('.codestory/comments.json', COMMENTS);

console.log('\nDemo repo built at: ' + DEMO);

if (process.env.CODESTORY_DEMO_NO_SERVE) {
  console.log('\n(skipping serve; CODESTORY_DEMO_NO_SERVE set)');
  process.exit(0);
}

console.log('\nOpening the app — pick the saved story or view the diff. Ctrl-C to stop.\n');
try {
  execFileSync('node', [SERVER_ENTRY, '--dir', DEMO], { stdio: 'inherit' });
} catch {
  /* Ctrl-C */
}
