import {
  BaseColumn,
  DduItem,
  ItemHighlight,
} from "https://deno.land/x/ddu_vim@v3.0.0/types.ts";
import { GetTextResult } from "https://deno.land/x/ddu_vim@v3.0.0/base/column.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v3.0.0/deps.ts";
import { basename } from "https://deno.land/std@0.190.0/path/mod.ts";

type Params = {
  collapsedIcon: string;
  expandedIcon: string;
  iconWidth: number;
  linkIcon: string;
  highlights: HighlightGroup;
};

type HighlightGroup = {
  directoryIcon?: string;
  directoryName?: string;
  linkIcon?: string;
  linkName?: string;
};

type ActionData = {
  isDirectory?: boolean;
  isLink?: boolean;
  path?: string;
};

type IconData = {
  icon: string;
  hiGroup: string;
  color: string;
};

export class Column extends BaseColumn<Params> {
  private readonly textEncoder = new TextEncoder();

  override async getLength(args: {
    denops: Denops;
    columnParams: Params;
    items: DduItem[];
  }): Promise<number> {
    const widths = await Promise.all(args.items.map(
      async (item) => {
        const action = item?.action as ActionData;
        const isLink = action.isLink ?? false;
        const isDirectory = item.isTree ?? false;
        let path = basename(action.path ?? item.word) +
          (isDirectory ? "/" : "");

        if (isLink && action.path) {
          path += ` -> ${await Deno.realPath(action.path)}`;
        }

        // indent + icon + spacer + filepath
        const length = (item.__level * 2) + args.columnParams.iconWidth + 1 + (await fn.strwidth(
          args.denops,
          path,
        ) as number);

        return length;
      },
    )) as number[];
    return Math.max(...widths);
  }

  override async getText(args: {
    denops: Denops;
    columnParams: Params;
    startCol: number;
    endCol: number;
    item: DduItem;
  }): Promise<GetTextResult> {
    const action = args.item?.action as ActionData;
    const highlights: ItemHighlight[] = [];
    const isDirectory = args.item.isTree ?? false;
    const isLink = action.isLink ?? false;
    let path = basename(action.path ?? args.item.word) +
      (isDirectory ? "/" : "");

    if (isLink && action.path) {
      path += ` -> ${await Deno.realPath(action.path)}`;
    }

    const directoryIcon = args.item.__expanded
      ? ""
      : isLink
      ? ""
      : "";
    const icon = isDirectory
      ? directoryIcon
      : isLink
      ? ""
      : "";

    const indent = "├ ".repeat(args.item.__level)

    highlights.push({
      name: "column-filename-icon",
      hl_group: "Special",
      col: args.startCol + this.textEncoder.encode(indent).length,
      width: this.textEncoder.encode(icon).length,
    });

    const text = indent + icon + " " + path;
    const width = await fn.strwidth(args.denops, text) as number;
    const padding = " ".repeat(args.endCol - args.startCol - width);

    return Promise.resolve({
      text: text + padding,
      highlights: highlights,
    });
  }

  override params(): Params {
    return {
      collapsedIcon: "",
      expandedIcon: "",
      iconWidth: 1,
      linkIcon: "@",
      highlights: {},
    };
  }
}

const icons = new Map<string, IconData>([
  ['default', {icon:"+", hiGroup: "", color: ""}],
])
