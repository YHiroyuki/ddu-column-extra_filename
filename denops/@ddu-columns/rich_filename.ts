import {
  BaseColumn,
  ColumnOptions,
  DduItem,
  ItemHighlight,
} from "https://deno.land/x/ddu_vim@v3.0.0/types.ts";
import { GetTextResult } from "https://deno.land/x/ddu_vim@v3.0.0/base/column.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v3.0.0/deps.ts";
import { basename, extname } from "https://deno.land/std@0.190.0/path/mod.ts";
import { crypto, toHashString } from "https://deno.land/std@0.190.0/crypto/mod.ts";

type Params = {
  sort: string;
  sortTreesFirst: boolean;
};

type ActionData = {
  isDirectory?: boolean;
  isLink?: boolean;
  path?: string;
};

type IconData = {
  icon: string;
  color: string;
};

type GitStatus = {
  status: number;
  color: string;
};

export class Column extends BaseColumn<Params> {
  private readonly textEncoder = new TextEncoder();
  private lastFilenameInDir = new Map<string, string>;
  private gitRoot: string | undefined;
  private gitFilenames = new Map<string, string>;
  private gitStatusHash = '';
  private readonly defaultFileIcon = {icon: "", color: palette.default};

  constructor() {
    super();
  }

  override async onInit(args: {
    denops: Denops;
    columnOptions: ColumnOptions;
    columnParams: Params;
  }): Promise<void> {
    await super.onInit(args);

    for (const [colorName, colorCode] of colors) {
      const highlightGroup = this.getHighlightName(colorName);

      if (colorCode.startsWith("#")) {
        await args.denops.cmd(`hi default ${highlightGroup} guifg=${colorCode}`);
      } else {
        await args.denops.cmd(`hi default link ${highlightGroup} ${colorCode}`);
      }
    }
  }

  override async getLength(args: {
    denops: Denops;
    columnParams: Params;
    items: DduItem[];
  }): Promise<number> {
    this.setLastFilenameInDir(args.items, args.columnParams);
    this.initGit(args.denops);
    this.checkGitDiff(args.denops);

    const widths = args.items.map(
      (item) => {
        const action = item?.action as ActionData;
        const isDirectory = item.isTree ?? false;
        const path = basename(action.path ?? item.word) + (isDirectory ? "/" : "");
        const length = (item.__level * 3) + 3 + 1 + path.length;

        return length;
      }
    ) as number[];

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

    const indent = this.getIndent(action.path ?? '', args.item.__level);
    const indentBytesLength = this.textEncoder.encode(indent).length;

    const iconData = this.getIcon(path, args.item.__expanded, isDirectory, isLink); 
    const iconBytesLength = this.textEncoder.encode(iconData.icon).length;

    highlights.push({
      name: "column-filename-icon",
      hl_group: this.getHighlightName(iconData.color),
      col: args.startCol + indentBytesLength,
      width: iconBytesLength,
    });

    const fullPath = (action.path ?? '') + (isDirectory ? "/" : "");
    const gitStatus = this.getGitStatus(fullPath)
    if (gitStatus != null) {
      highlights.push({
        name: "column-filename-name",
        hl_group: this.getHighlightName(gitStatus.color),
        col: args.startCol + indentBytesLength + iconBytesLength + 1,
        width: this.textEncoder.encode(path).length,
      });
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
      sort: 'none',
      sortTreesFirst: false,
    };
  }

  private async initGit(denops: Denops) {
    if (this.gitRoot != undefined) {
      return;
    }
    const gitRoot = await denops.call("system", 'git rev-parse --show-superproject-working-tree --show-toplevel 2>/dev/null | head -1');
    this.gitRoot = (gitRoot as string).trim();
  }

  private async checkGitDiff(denops: Denops) {
    if (this.gitRoot == '' || this.gitRoot == undefined) {
      return;
    }
    const gitStatusData = await denops.call("system", 'git status --porcelain -u')
    const gitStatusString = (gitStatusData as string).trimEnd();
    const hash = toHashString(crypto.subtle.digestSync('MD5', this.textEncoder.encode(gitStatusString)));
    if (hash == this.gitStatusHash) {
      return;
    }
    this.gitStatusHash = hash;

    this.gitFilenames = new Map<string, string>();
    for (const gitStatus of gitStatusString.split("\n")) {
      const status = gitStatus.slice(0, 3).trim()
      const name = gitStatus.slice(3)
      this.gitFilenames.set(`${this.gitRoot}/${name}`, status);
    }
  }

  private getGitStatus(fullPath: string): GitStatus | null {
    const status = this.gitFilenames.get(fullPath) ?? '';
    if (status != '') {
      return gitStatuses.get(status) ?? null;
    }

    let st = null;
    for (const key of this.gitFilenames.keys()) {
      if (key.startsWith(fullPath)) {
        const s = this.gitFilenames.get(key) ?? null;
        if (s == null) {
          continue;
        }
        if (st == null || st > s) {
          st = s;
        }

      }
    }
    if (st == null) {
      return null;
    }

    return gitStatuses.get(st) ?? null;
  }

  private setLastFilenameInDir(items: DduItem[], columnParams: Params): void {
    if (items.length <= 1) {
      return;
    }
    const levels = items.map((item) => {
      return item.__level;
    });
    const level = Math.max(...levels);
    const levelItems = items.filter((item) => {
      return item.__level == level;
    });

    const sortMethod = columnParams.sort.toLowerCase();
    const sortFunc = sortMethod === "extension"
      ? sortByExtension
      : sortMethod === "size"
      ? sortBySize
      : sortMethod === "time"
      ? sortByTime
      : sortMethod === "filename"
      ? sortByFilename
      : sortByNone;
    let sortedItems = levelItems.sort(sortFunc);
    if (columnParams.sortTreesFirst) {
      const dirs = sortedItems.filter((item) => item.isTree);
      const files = sortedItems.filter((item) => !item.isTree);
      sortedItems = dirs.concat(files);
    }

    if (sortedItems.length > 0) {
      const item = sortedItems[sortedItems.length - 1];
      const path = item.treePath ?? '';
      const paths = path.split("/");
      const name = paths.slice(-1)[0];
      const parentPath = paths.slice(0, -1).join("/");
      this.lastFilenameInDir.set(parentPath, name);
    }
  }

  private getIndent(path: string, level: number): string {
    const indents = [];

    const paths = path.split("/");
    for (let i = 0; i < level; i++) {
      const parentPath = paths.slice(0, -1).join("/");
      const name = paths.pop();
      if (name == undefined) {
        break;
      }

      const lastName = this.lastFilenameInDir.get(parentPath) ?? "";
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
    return indents.join('');
  }

  private getIcon(
    fileName: string,
    expanded: boolean,
    isDirectory: boolean,
    isLink: boolean,
  ): IconData {
    if (expanded) {
      return specialIcons.get('directory_expanded') ?? this.defaultFileIcon;
    } else if (isDirectory) {
      if (isLink) {
        return specialIcons.get('directory_link') ?? this.defaultFileIcon;
      }
      return specialIcons.get('directory') ?? this.defaultFileIcon;
    }
    if (isLink) {
      return specialIcons.get('link') ?? this.defaultFileIcon;
    }

    const ext = extname(fileName).substring(1);
    return extensionIcons.get(ext) ?? this.defaultFileIcon;
  }

  private getHighlightName(highlightGroup: string): string
  {
    return `DduColumnRichFilename_${highlightGroup}`;
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
  default: "default",
  aqua: "aqua",
  beige: "beige",
  blue: "blue",
  brown: "brown",
  darkBlue: "darkBlue",
  darkOrange: "darkOrange",
  green: "green",
  lightGreen: "lightGreen",
  lightPurple: "lightPurple",
  orange: "orange",
  pink: "pink",
  purple: "purple",
  red: "red",
  salmon: "salmon",
  yellow: "yellow",
};

const specialIcons = new Map<string, IconData>([
  ['directory_expanded', {icon: "", color: palette.green}],
  ['directory_link', {icon: "", color: palette.green}],
  ['directory', {icon: "", color: palette.green}],
  ['link', {icon: "", color: palette.green}],
]);

const extensionIcons = new Map<string, IconData>([
  ['html', {icon: "", color: palette.darkOrange}],
  ['htm', {icon: "", color: palette.darkOrange}],
  ['sass', {icon: "", color: palette.default}],
  ['scss', {icon: "", color: palette.pink}],
  ['css', {icon: "", color: palette.blue}],
  ['md', {icon: "", color: palette.yellow}],
  ['markdown', {icon: "", color: palette.yellow}],
  ['json', {icon: "", color: palette.beige}],
  ['js', {icon: "", color: palette.beige}],
  ['rb', {icon: "", color: palette.red}],
  ['php', {icon: "", color: palette.purple}],
  ['py', {icon: "", color: palette.yellow}],
  ['pyc', {icon: "", color: palette.yellow}],
  ['vim', {icon: "", color: palette.green}],
  ['toml', {icon: "", color: palette.default}],
  ['sh', {icon: "", color: palette.lightPurple}],
  ['go', {icon: "", color: palette.aqua}],
  ['ts', {icon: "", color: palette.blue}],

]);

const statusNumbers = {
  delete: 8,
  modified: 7,
  type_change: 6,
  add: 5,
  rename: 4,
  copy: 3,
  update:2,
  undefined: 1,
}

const gitStatuses = new Map<string, GitStatus>([
  ['M', {status: statusNumbers.modified, color: palette.green}],
  ['T', {status: statusNumbers.type_change, color: palette.yellow}],
  ['A', {status: statusNumbers.add, color: palette.blue}],
  ['D', {status: statusNumbers.delete, color: palette.salmon}],
  ['R', {status: statusNumbers.rename, color: palette.yellow}],
  ['C', {status: statusNumbers.copy, color: palette.blue}],
  ['U', {status: statusNumbers.update, color: palette.green}],
  ['??', {status: statusNumbers.undefined, color: palette.yellow}],
]);

const sortByFilename = (a: DduItem, b: DduItem) => {
  const nameA = a.treePath ?? a.word;
  const nameB = b.treePath ?? b.word;
  return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
};

const sortByExtension = (a: DduItem, b: DduItem) => {
  const nameA = extname(a.word);
  const nameB = extname(b.word);
  return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
};

const sortBySize = (a: DduItem, b: DduItem) => {
  const sizeA = a.status?.size ?? -1;
  const sizeB = b.status?.size ?? -1;
  return sizeA < sizeB ? -1 : sizeA > sizeB ? 1 : 0;
};

const sortByTime = (a: DduItem, b: DduItem) => {
  const timeA = a.status?.time ?? -1;
  const timeB = b.status?.time ?? -1;
  return timeA < timeB ? -1 : timeA > timeB ? 1 : 0;
};

const sortByNone = (_a: DduItem, _b: DduItem) => {
  return 0;
};
