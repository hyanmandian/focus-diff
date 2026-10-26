import { createCn } from "cn/config";

// Class merging (clsx + tailwind-merge), told about the platform's text styles (index.css) so
// `text-body` counts as a size: otherwise it reads as a colour and a `text-destructive` after it
// would drop it.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["large-title", "title1", "title2", "title3", "headline", "body", "callout", "subheadline", "footnote"],
        },
      ],
    },
  },
});
