// Bundle entry for "Explain code". Built by scripts/build-client.mjs into
// dist/client/explain.js and requested by the shell's module script.
import type { ExplainPayload } from "../../src/payloads";
import { mountSurface } from "../shared/mount";
import { readShellPayload } from "../shared/payload";
import { ExplainApp } from "../surfaces/explain/ExplainApp";

mountSurface(<ExplainApp payload={readShellPayload<ExplainPayload>()} />);
