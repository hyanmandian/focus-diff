import { defineBackground } from "#imports";
import { startBackground } from "@/utils/background/background";

// Called inside a function written here: preparing the build (`wxt prepare`) loads this file with the
// function's body taken out, so what it imports (generated messages, among them) isn't needed yet.
export default defineBackground(() => {
  startBackground();
});
