import { WorkerPool } from "../../workers/pool";
import SvgWorker from "./svg.worker.ts?worker";

export const svgPool = new WorkerPool(() => new SvgWorker());
