import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import prefillRouter from "./prefill";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyzeRouter);
router.use(prefillRouter);

export default router;
