// First run (or "Run setup again"): the desktop's setup window.
import { Setup } from "@focus-diff/app/components/setup";

import { startPage } from "@/utils/start-page/start-page";

import "@/assets/pages.css";

startPage("setup", <Setup />);
