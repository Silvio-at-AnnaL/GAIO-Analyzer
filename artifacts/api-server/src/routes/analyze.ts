import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { StartAnalysisBody, GetAnalysisReportParams } from "@workspace/api-zod";
import { runAnalysis, getAnalysis } from "../lib/analysis-engine";

const router: IRouter = Router();

router.post("/analyze", async (req, res): Promise<void> => {
  const parsed = StartAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { mode, url, html, questionnaire } = parsed.data;

  if (mode === "url" && (!url || url.trim().length === 0)) {
    res.status(400).json({ error: "URL is required for URL mode" });
    return;
  }

  if (mode === "html" && (!html || html.trim().length === 0)) {
    res.status(400).json({ error: "HTML content is required for HTML mode" });
    return;
  }

  const id = uuidv4();

  runAnalysis(id, mode, url || null, html || null, questionnaire);

  res.status(201).json({ id, status: "running" });
});

router.get("/analyze/:id", async (req, res): Promise<void> => {
  const params = GetAnalysisReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const analysis = getAnalysis(params.data.id);
  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  res.json(analysis);
});

router.get("/analyze/:id/events", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(() => {
    const analysis = getAnalysis(id);
    if (!analysis) {
      sendEvent({ error: "Analysis not found" });
      clearInterval(interval);
      res.end();
      return;
    }

    sendEvent({
      status: analysis.status,
      progress: analysis.progress,
      currentModule: analysis.currentModule,
    });

    if (analysis.status === "completed" || analysis.status === "failed") {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

export default router;
