import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import prefillRouter from "./prefill";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyzeRouter);
router.use(prefillRouter);
router.use("/admin", adminRouter);

export default router;
