// The popup: the desktop's panel under the tray icon, under the toolbar button.
import { Panel } from "@focus-diff/app/components/panel";
import { start } from "@focus-diff/app/utils/store";

import { startPage } from "@/utils/start-page/start-page";

import "@/assets/pages.css";

startPage("panel", <Panel />);
void start();
