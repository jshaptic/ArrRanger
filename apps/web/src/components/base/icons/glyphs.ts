import type { Component } from 'vue';
import {
  RiAddFill,
  RiAddLine,
  RiAlertFill,
  RiAlertLine,
  RiArrowDownFill,
  RiArrowDownLine,
  RiArrowDownSFill,
  RiArrowDownSLine,
  RiArrowLeftFill,
  RiArrowLeftLine,
  RiArrowRightFill,
  RiArrowRightLine,
  RiArrowRightSFill,
  RiArrowRightSLine,
  RiArrowUpFill,
  RiArrowUpLine,
  RiArrowUpSFill,
  RiArrowUpSLine,
  RiCheckFill,
  RiCheckLine,
  RiCloseCircleFill,
  RiCloseCircleLine,
  RiCloseFill,
  RiCloseLine,
  RiDeleteBinFill,
  RiDeleteBinLine,
  RiFileFill,
  RiFileLine,
  RiFolderOpenFill,
  RiFolderOpenLine,
  RiGitMergeFill,
  RiGitMergeLine,
  RiHardDrive2Fill,
  RiHardDrive2Line,
  RiInboxArchiveFill,
  RiInboxArchiveLine,
  RiIndeterminateCircleFill,
  RiIndeterminateCircleLine,
  RiLinkM,
  RiLoader4Fill,
  RiLoader4Line,
  RiPencilFill,
  RiPencilLine,
  RiPlugFill,
  RiPlugLine,
  RiPriceTag3Fill,
  RiPriceTag3Line,
  RiQuestionFill,
  RiQuestionLine,
  RiQuestionMark,
  RiRefreshFill,
  RiRefreshLine,
  RiSearchFill,
  RiSearchLine,
  RiStackFill,
  RiStackLine,
  RiSubtractFill,
  RiSubtractLine,
  RiToggleFill,
  RiToggleLine,
  RiZoomInFill,
  RiZoomInLine,
} from '@remixicon/vue';

/**
 * The app's single point of contact with an icon library.
 *
 * Everything above this file talks in meanings - "warning", "collapsed", "absent" - and
 * this is the one place that says which drawings a meaning maps to. Swapping
 * `@remixicon/vue` for anything else is a rewrite of this file and no other: the 36
 * wrappers beside it, every call site, the three central maps and every `data-icon`
 * assertion in the suite go untouched.
 *
 * What a replacement has to supply, per drawing, is the whole contract `BaseIcon` relies
 * on: a component rendering a single-root `<svg>` that merges a fall-through `class` and
 * colours itself with `currentColor`. That holds for lucide-vue-next, @heroicons/vue,
 * unplugin-icons and a hand-written inline-SVG SFC, so none of them would need more than
 * this file. `icons.test.ts` pins the contract, and pins the fact that nothing else in
 * `apps/web/src` names an icon library.
 */

/**
 * One meaning, drawn at two weights. `solid` is optional because not every set ships a
 * filled twin for every glyph; `BaseIcon` falls back to `outline` rather than blanking,
 * so `variant="solid"` is a request that can go politely unhonoured.
 */
export interface GlyphEntry {
  readonly outline: Component;
  readonly solid?: Component;
}


/* Queue operations - the glyph half of `presentOp` in `@/lib/staging`. */
export const CreateGlyph: GlyphEntry = { outline: RiAddLine, solid: RiAddFill };
export const EditGlyph: GlyphEntry = { outline: RiPencilLine, solid: RiPencilFill };
/** A bin, not another cross: deleting a tag and closing a modal were the same character. */
export const DeleteGlyph: GlyphEntry = { outline: RiDeleteBinLine, solid: RiDeleteBinFill };
export const MergeGlyph: GlyphEntry = { outline: RiGitMergeLine, solid: RiGitMergeFill };
export const RemoveGlyph: GlyphEntry = { outline: RiSubtractLine, solid: RiSubtractFill };
export const MoveGlyph: GlyphEntry = { outline: RiArrowRightLine, solid: RiArrowRightFill };
export const ToggleGlyph: GlyphEntry = { outline: RiToggleLine, solid: RiToggleFill };
export const RefreshGlyph: GlyphEntry = { outline: RiRefreshLine, solid: RiRefreshFill };

/* Severity - the amber/red vocabulary `SEVERITY_STYLES` renders. */
export const WarningGlyph: GlyphEntry = { outline: RiAlertLine, solid: RiAlertFill };
/** Circled, so severity and the plain cross of a close button stay distinguishable. */
export const ErrorGlyph: GlyphEntry = { outline: RiCloseCircleLine, solid: RiCloseCircleFill };

/* The folder tree's twisty, which draws one of five states. */
export const LoadingGlyph: GlyphEntry = { outline: RiLoader4Line, solid: RiLoader4Fill };
export const FileGlyph: GlyphEntry = { outline: RiFileLine, solid: RiFileFill };
export const ExpandedGlyph: GlyphEntry = { outline: RiArrowDownSLine, solid: RiArrowDownSFill };
export const CollapsedGlyph: GlyphEntry = { outline: RiArrowRightSLine, solid: RiArrowRightSFill };

/* Chrome and controls. */
export const CloseGlyph: GlyphEntry = { outline: RiCloseLine, solid: RiCloseFill };
export const CheckGlyph: GlyphEntry = { outline: RiCheckLine, solid: RiCheckFill };
/** The circled `?`, which reads as "explain this" rather than "no answer". */
export const HelpGlyph: GlyphEntry = { outline: RiQuestionLine, solid: RiQuestionFill };
/** A lens with a plus: this re-roots the view at the folder, it does not select it. */
export const FocusGlyph: GlyphEntry = { outline: RiZoomInLine, solid: RiZoomInFill };
export const MoveUpGlyph: GlyphEntry = { outline: RiArrowUpLine, solid: RiArrowUpFill };
export const MoveDownGlyph: GlyphEntry = { outline: RiArrowDownLine, solid: RiArrowDownFill };
export const BackGlyph: GlyphEntry = { outline: RiArrowLeftLine, solid: RiArrowLeftFill };
export const DropdownGlyph: GlyphEntry = { outline: RiArrowDownSLine, solid: RiArrowDownSFill };
/**
 * Drawer chrome. Rendered `variant="solid"` at its one call site - the `▼`/`▲` it
 * replaced are solid, and a hairline chevron vanishes at that size. Deliberately its own
 * meaning rather than a reuse of `Expanded`, so restyling a tree twisty cannot silently
 * restyle a drawer.
 */
export const CaretDownGlyph: GlyphEntry = { outline: RiArrowDownSLine, solid: RiArrowDownSFill };
export const CaretUpGlyph: GlyphEntry = { outline: RiArrowUpSLine, solid: RiArrowUpSFill };
export const RenameArrowGlyph: GlyphEntry = { outline: RiArrowRightSLine, solid: RiArrowRightSFill };
export const SkipGlyph: GlyphEntry = { outline: RiIndeterminateCircleLine, solid: RiIndeterminateCircleFill };
/** A matrix cell the instance simply does not have - a state, not a blank. */
export const AbsentGlyph: GlyphEntry = { outline: RiSubtractLine, solid: RiSubtractFill };

/* Empty states. */
export const StorageGlyph: GlyphEntry = { outline: RiHardDrive2Line, solid: RiHardDrive2Fill };
export const SearchGlyph: GlyphEntry = { outline: RiSearchLine, solid: RiSearchFill };
export const FolderOpenGlyph: GlyphEntry = { outline: RiFolderOpenLine, solid: RiFolderOpenFill };
export const TagGlyph: GlyphEntry = { outline: RiPriceTag3Line, solid: RiPriceTag3Fill };
export const QueueGlyph: GlyphEntry = { outline: RiStackLine, solid: RiStackFill };
export const ImportListGlyph: GlyphEntry = { outline: RiInboxArchiveLine, solid: RiInboxArchiveFill };
export const InstanceGlyph: GlyphEntry = { outline: RiPlugLine, solid: RiPlugFill };
/* The two Remix ships with no -Line/-Fill pair. `variant="solid"` draws the outline. */

/** The bare `?` of an instance that did not answer - deliberately not the circled one. */
export const UnknownGlyph: GlyphEntry = { outline: RiQuestionMark };

/** `RiLinksLine`/`RiLinksFill` exist but draw a chain of links, not the single one. */
export const SymlinkGlyph: GlyphEntry = { outline: RiLinkM };
