import {
  BaseColumn,
  DduItem,
  ItemHighlight,
} from "https://deno.land/x/ddu_vim@v3.0.0/types.ts";
import { GetTextResult } from "https://deno.land/x/ddu_vim@v3.0.0/base/column.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v3.0.0/deps.ts";
import { basename, extname } from "https://deno.land/std@0.190.0/path/mod.ts";


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
  highlightGroup: string;
  color: string;
};

type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export class Column extends BaseColumn<Params> {
  private readonly textEncoder = new TextEncoder();
  private cache = new Map<string, string>;

  constructor() {
    super();
  }

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

    const indent = await this.getIndent(action.path ?? '', args.item.__level);
    const indentBytesLength = this.textEncoder.encode(indent).length;

    const iconData = this.getIcon(path, args.item.__expanded, isDirectory, isLink); 
    const iconBytesLength = this.textEncoder.encode(iconData.icon).length;
    const highlightGroup = `ddu_column_${iconData.highlightGroup}`;
    highlights.push({
      name: "column-filename-icon",
      hl_group: highlightGroup,
      col: args.startCol + indentBytesLength,
      width: iconBytesLength,
    });

    const color = (() => {
      const c = iconData.color;
      return c.startsWith("!")
        ? colors.get(c.slice(1)) ?? "Normal"
        : c;
    })();
    if (color.startsWith("#")) {
      await args.denops.cmd(`hi default ${highlightGroup} guifg=${color}`);
    } else {
      await args.denops.cmd(`hi default link ${highlightGroup} ${color}`);
    }

    const text = indent + iconData.icon + " " + path;
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

  private async getIndent(path: string, level: number): Promise<string> {
    const indents = [];

    for (let i = 0; i < level; i++) {
      const paths = path.split("/");
      const name = paths.slice(-1)[0];
      const parentPath = paths.slice(0, -1).join("/");
      if (!this.cache.has(parentPath)) {
        let entry: DirEntry | null = null;
        for await (const _entry of Deno.readDir(parentPath)) {
          if (entry == null) {
            entry = _entry as DirEntry;
          } else if (entry.isDirectory == _entry.isDirectory) {
            if (entry.name < _entry.name) {
              entry = _entry as DirEntry;
            }

          } else if (!_entry.isDirectory) {
            entry = _entry as DirEntry;
          }
        }
        if (entry != null) {
          this.cache.set(parentPath, entry.name);
        }
      }
      path = parentPath

      const lastName = this.cache.get(parentPath) ?? "";
      const isLast = lastName == name;
      if (i == 0) {
        if (isLast) {
          indents.unshift("└ ");
        } else {
          indents.unshift("├ ");
        }
      } else {
        if (isLast) {
          indents.unshift("  ");
        } else {
          indents.unshift("│ ");
        }
      }

    }
    return Promise.resolve(indents.join(''));
  }

  private getIcon(
    fileName: string,
    expanded: boolean,
    isDirectory: boolean,
    isLink: boolean,
  ): IconData {
    if (expanded) {
      return {icon: "", highlightGroup: "directory_expanded", color: palette.green};
    } else if (isDirectory) {
      if (isLink) {
        return {icon: "", highlightGroup: "directory_link", color: palette.green};
      }
      return {icon: "", highlightGroup: "directory", color: palette.green};
    }
    if (isLink) {
      return {icon: "", highlightGroup: "link", color: palette.green};

    }

    const ext = extname(fileName).substring(1);
    return extentionIcons.get(ext) ?? {icon: "", highlightGroup: "file", color: "Normal"};
  }
}
const colors = new Map<string, string>([
  ["default", "Normal"],
  ["aqua", "#3AFFDB"],
  ["beige", "#F5C06F"],
  ["blue", "#689FB6"],
  ["brown", "#905532"],
  ["darkBlue", "#44788E"],
  ["darkOrange", "#F16529"],
  ["green", "#8FAA54"],
  ["lightGreen", "#31B53E"],
  ["lightPurple", "#834F79"],
  ["orange", "#D4843E"],
  ["pink", "#CB6F6F"],
  ["purple", "#834F79"],
  ["red", "#AE403F"],
  ["salmon", "#EE6E73"],
  ["yellow", "#F09F17"],
]);

const palette = {
  default: "!default",
  aqua: "!aqua",
  beige: "!beige",
  blue: "!blue",
  brown: "!brown",
  darkBlue: "!darkBlue",
  darkOrange: "!darkOrange",
  green: "!green",
  lightGreen: "!lightGreen",
  lightPurple: "!lightPurple",
  orange: "!orange",
  pink: "!pink",
  purple: "!purple",
  red: "!red",
  salmon: "!salmon",
  yellow: "!yellow",
};

const extentionIcons = new Map<string, IconData>([
  ['html', {icon: "", highlightGroup: "file_html", color: palette.darkOrange}],
  ['htm', {icon: "", highlightGroup: "file_htm", color: palette.darkOrange}],
  ['sass', {icon: "", highlightGroup: "file_sass", color: palette.default}],
  ['scss', {icon: "", highlightGroup: "file_scss", color: palette.pink}],
  ['css', {icon: "", highlightGroup: "file_css", color: palette.blue}],
  ['md', {icon: "", highlightGroup: "file_md", color: palette.yellow}],
  ['markdown', {icon: "", highlightGroup: "file_markdown", color: palette.yellow}],
  ['json', {icon: "", highlightGroup: "file_json", color: palette.beige}],
  ['js', {icon: "", highlightGroup: "file_js", color: palette.beige}],
  ['rb', {icon: "", highlightGroup: "file_rb", color: palette.red}],
  ['php', {icon: "", highlightGroup: "file_php", color: palette.purple}],
  ['py', {icon: "", highlightGroup: "file_py", color: palette.yellow}],
  ['pyc', {icon: "", highlightGroup: "file_pyc", color: palette.yellow}],
  ['vim', {icon: "", highlightGroup: "file_vim", color: palette.green}],
  ['toml', {icon: "", highlightGroup: "file_toml", color: palette.default}],
  ['sh', {icon: "", highlightGroup: "file_sh", color: palette.lightPurple}],
  ['go', {icon: "", highlightGroup: "file_go", color: palette.aqua}],
  ['ts', {icon: "", highlightGroup: "file_ts", color: palette.blue}],

]);

