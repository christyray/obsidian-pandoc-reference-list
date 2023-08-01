import { syntaxTree } from '@codemirror/language';
import { tokenClassNodeProp } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Tree } from '@lezer/common';
import {
  Keymap,
  editorInfoField,
  editorLivePreviewField,
  livePreviewState,
} from 'obsidian';

import {
  RenderedCitation,
  Segment,
  SegmentType,
  getCitationSegments,
} from './parser/parser';
import { BibManager, FileCache } from './bib/bibManager';
import equal from 'fast-deep-equal';
import { TooltipManager } from './tooltip';

const ignoreListRegEx = /code|math|templater|hashtag/;

const citeMark = (
  citekey: string,
  sourceFile: string | undefined,
  isResolved: boolean,
  isUnresolved: boolean,
  noteIndex?: string
) => {
  const cls = ['cm-pandoc-citation', 'pandoc-citation'];

  if (isResolved) cls.push('is-resolved');
  if (isUnresolved) cls.push('is-unresolved');

  const attr: Record<string, string> = {
    'data-citekey': citekey,
    'data-source': sourceFile || '',
  };

  if (noteIndex) attr.noteIndex = noteIndex;

  return Decoration.mark({
    class: cls.join(' '),
    attributes: attr,
  });
};

const citeMarkFormatting = (type: string) => {
  return Decoration.mark({
    class: `cm-pandoc-citation-formatting ${type}`,
  });
};

const citeMarkExtra = (type: string) => {
  return Decoration.mark({
    class: `cm-pandoc-citation-extra ${type}`,
  });
};

export function editorTooltipHandler(manager: TooltipManager) {
  return EditorView.domEventHandlers(manager.getEditorTooltipHandler());
}

class CiteWidget extends WidgetType {
  cite: RenderedCitation;
  sourcePath?: string;
  linkText?: string;

  constructor(cite: RenderedCitation, sourcePath?: string, linkText?: string) {
    super();
    this.cite = cite;
    this.sourcePath = sourcePath;
    this.linkText = linkText;
  }

  eq(widget: this): boolean {
    return this.cite === widget.cite;
  }

  toDOM() {
    // Adds the different attributes to the citations in Editing mode
    const attr: Record<string, string> = {
      'data-citekey': this.cite.citations.map((c) => c.id).join('|'),
      'data-source': this.sourcePath,
      'data-citetype': this.cite.citations[0].citeType || 'lit',
    };

    if (this.cite.note) {
      attr['data-note-index'] = this.cite.noteIndex.toString();
    }

    return createSpan(
      {
        cls: 'pandoc-citation is-resolved',
        attr,
      },
      (span) => {
        if (this.linkText) {
          span.addClass('is-link');
          span.addEventListener('click', (evt) => {
            const newPane = Keymap.isModEvent(evt);
            activeWindow.setTimeout(() => {
              app.workspace.openLinkText(
                this.linkText,
                this.sourcePath,
                newPane
              );
            }, 100);
          });
        }

        if (/</.test(this.cite.val)) {
          const parsed = new DOMParser().parseFromString(
            this.cite.val,
            'text/html'
          );
          span.append(...Array.from(parsed.body.childNodes));
        } else {
          span.setText(this.cite.val);
        }
      }
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const citeDeco = (
  cite: RenderedCitation,
  sourcePath?: string,
  linkText?: string
) =>
  Decoration.replace({
    widget: new CiteWidget(cite, sourcePath, linkText),
  });

// I replaced the original "onlyValType" function with "onlyKey" to also match 
// citations with internal links
// function onlyValType(segs: Segment[]) {
//   return segs.map((s) => ({ type: s.type, val: s.val }));
// }
function onlyKey(segs: Segment[]) {
  let valType = segs.map((s) => ({ type: s.type, val: s.val }));
  return valType.filter((s) => s.type === "key" );
}

export const citeKeyPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.mkDeco(view);
    }
    update(update: ViewUpdate) {
      if (
        update.viewportChanged ||
        update.docChanged ||
        update.transactions.some((tr) =>
          tr.effects.some(
            (e) =>
              e.is(setCiteKeyCache) || e.value?.field === editorLivePreviewField
          )
        ) ||
        (update.view.state.field(editorLivePreviewField) &&
          update.selectionSet &&
          !update.view.plugin(livePreviewState)?.mousedown)
      ) {
        this.decorations = this.mkDeco(update.view);
      }
    }
    mkDeco(view: EditorView) {
      const {
        plugin: { settings },
      } = view.state.field(bibManagerField);

      const b = new RangeSetBuilder<Decoration>();
      const obsView = view.state.field(editorInfoField);
      let citekeyCache = view.state.field(citeKeyCacheField);
      const isLivePreview =
        settings.renderCitations && view.state.field(editorLivePreviewField);

      // Don't get the syntax tree until we have to
      let tree: Tree;

      // Sort citations by note index to ensure correct citation versions get
      // matched and filtered
      citekeyCache?.citations.sort((a, b) => a.noteIndex - b.noteIndex);

      const matched = new Set<RenderedCitation>();

      for (const { from, to } of view.visibleRanges) {
        const range = view.state.sliceDoc(from, to);
        const segments = getCitationSegments(
          range,
          !settings.renderLinkCitations
        );

        for (const match of segments) {
          if (!tree) tree = syntaxTree(view.state);

          // Determines the maximum noteIndex that has already been matched in 
          // the current section
          // ... spreads the set into individual values, which then can be 
          // mapped into to access the noteIndex values
          // Must select only the finite values to remove undefined values
          // before checking the max
          const indices = [...matched].map(
            (c) => c?.noteIndex).filter(value => Number.isFinite(value)
          );
          const maxIndex = Math.max(...indices);

          // Looks for all citations in the cache that have citekeys matching 
          // the citation segments in the current viewing range
          // Checking that the noteIndex is greater than the previous max to 
          // make sure it is not matching a citation from an earlier section
          // Originally needed to call `renderCrossrefType` here separately, but
          // that isn't necessary now that I am adding the crossref citations to
          // the cache
          const rendered = citekeyCache?.citations.find(
            (c) =>
              !matched.has(c) &&
              (c?.noteIndex >= maxIndex || c?.noteIndex == null) &&
              equal(onlyKey(c?.data || []), onlyKey(match)));

          if (rendered) {
            matched.add(rendered);
          }

          if (isLivePreview) {
            if (rendered) {
              const start = from + match[0].from;
              const end = from + match[match.length - 1].to;
              const center = Math.round((start + end) / 2);

              let linkText: string;

              const centerNode = tree.resolveInner(center, 0);

              if (
                centerNode.type
                  .prop(tokenClassNodeProp)
                  ?.includes('hmd-internal-link')
              ) {
                linkText = view.state.sliceDoc(centerNode.from, centerNode.to);
              }

              if (
                view.state.selection.ranges.every((r) => {
                  return (
                    !(start >= r.from && end <= r.to) &&
                    !(
                      (r.from >= start && r.from <= end) ||
                      (r.to >= start && r.to <= end)
                    )
                  );
                })
              ) {
                b.add(
                  start,
                  end,
                  citeDeco(rendered, obsView?.file.path, linkText)
                );
                continue;
              }
            }
          }

          for (let i = 0, len = match.length; i < len; i++) {
            const part = match[i];
            const next = match[i + 1];
            const start = from + part.from;
            const end = from + part.to;

            const nodeProps = tree
              .resolveInner(start, 1)
              .type.prop(tokenClassNodeProp);

            if (nodeProps && ignoreListRegEx.test(nodeProps)) {
              break;
            }

            switch (part.type) {
              case SegmentType.key: {
                const isUnresolved =
                  !nodeProps?.includes('link') &&
                  citekeyCache?.unresolvedKeys.has(part.val);
                const isResolved = citekeyCache?.resolvedKeys.has(part.val);

                b.add(
                  start,
                  end,
                  citeMark(
                    part.val,
                    obsView?.file.path,
                    isResolved,
                    isUnresolved,
                    rendered?.note ? rendered.noteIndex.toString() : undefined
                  )
                );
                continue;
              }
              case SegmentType.at: {
                const isUnresolved =
                  !!next &&
                  !nodeProps?.includes('link') &&
                  citekeyCache?.unresolvedKeys.has(next.val);
                const isResolved =
                  !!next && citekeyCache?.resolvedKeys.has(next.val);

                const classes: string[] = [part.type];

                if (isUnresolved) classes.push('is-unresolved');
                if (isResolved) classes.push('is-resolved');

                b.add(start, end, citeMarkFormatting(classes.join(' ')));
                continue;
              }
              case SegmentType.curlyBracket:
              case SegmentType.bracket:
                b.add(start, end, citeMarkFormatting(part.type));
                continue;
              case SegmentType.separator:
              case SegmentType.suppressor:
              case SegmentType.prefix:
              case SegmentType.suffix:
              case SegmentType.locator:
              case SegmentType.locatorLabel:
              case SegmentType.locatorSuffix:
                b.add(start, end, citeMarkExtra(part.type));
                continue;
            }
          }
        }
      }

      return b.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export const setCiteKeyCache = StateEffect.define<FileCache>();
export const citeKeyCacheField = StateField.define<FileCache>({
  create(state) {
    const obsView = state.field(editorInfoField);
    const bibManager = state.field(bibManagerField);

    if (obsView?.file && bibManager?.fileCache.has(obsView.file)) {
      return bibManager.fileCache.get(obsView.file);
    }

    return null;
  },
  update(state, tr) {
    for (const e of tr.effects) {
      if (e.is(setCiteKeyCache)) {
        state = e.value;
      }
    }

    return state;
  },
});

export const bibManagerField = StateField.define<BibManager>({
  create() {
    return null;
  },
  update(state) {
    return state;
  },
});
