import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import documentsRouter from "./documents";
import boqRouter from "./boq";
import openaiRouter from "./openai";
import modelsRouter from "./models";
import multiAgentBoqRouter from "./multi-agent-boq";
import rfiRouter from "./rfi";
import risksRouter from "./risks";
import tenderIntelligenceRouter from "./tender-intelligence";
import companyProfileRouter from "./company-profile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(documentsRouter);
router.use(boqRouter);
router.use(openaiRouter);
router.use(modelsRouter);
router.use(multiAgentBoqRouter);
router.use(rfiRouter);
router.use(risksRouter);
router.use(tenderIntelligenceRouter);
router.use(companyProfileRouter);

export default router;
