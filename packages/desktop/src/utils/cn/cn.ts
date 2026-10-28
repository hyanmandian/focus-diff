import { createCn } from "cn/config";

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
