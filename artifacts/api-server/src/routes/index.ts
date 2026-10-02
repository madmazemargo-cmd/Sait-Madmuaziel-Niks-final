import { Router, type IRouter } from "express";
import healthRouter from "./health";
import calendarRouter from "./calendar";
import catalogRouter from "./catalog";
import applicationsRouter from "./applications";
import reviewsRouter from "./reviews";

const router: IRouter = Router();

router.use(healthRouter);
router.use(calendarRouter);
router.use(catalogRouter);
router.use(applicationsRouter);
router.use(reviewsRouter);

export default router;
