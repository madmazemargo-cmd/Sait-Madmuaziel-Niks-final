import { Router, type IRouter } from "express";
import healthRouter from "./health";
import calendarRouter from "./calendar";
import applicationsRouter from "./applications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(calendarRouter);
router.use(applicationsRouter);

export default router;
