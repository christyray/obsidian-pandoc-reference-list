import { MarkdownPostProcessorContext } from 'obsidian';

import ReferenceList from './main';
import { Segment, SegmentType, getCitationSegments } from './parser/parser';
import equal from 'fast-deep-equal';

function getCiteClass(isResolved: boolean, isUnresolved: boolean) {
  const cls = ['pandoc-citation'];
  if (isResolved) cls.push('is-resolved');
  if (isUnresolved) cls.push('is-unresolved');

  return cls.join(' ');
}

// I replaced the original "onlyValType" function with "onlyKey" to also match 
// citations with internal links
// function onlyValType(segs: Segment[]) {
//   return segs.map((s) => ({ type: s.type, val: s.val }));
// }
function onlyKey(segs: Segment[]) {
  let valType = segs.map((s) => ({ type: s.type, val: s.val }));
  return valType.filter((s) => s.type === "key" );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function processCiteKeys(plugin: ReferenceList) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const toRemove: Node[] = [];
    const walker = el.doc.createNodeIterator(el, NodeFilter.SHOW_TEXT);
    const sectionInfo = ctx.getSectionInfo(el);

    if (!sectionInfo && !el.hasClass('markdown-preview-view')) return;

    // We wont get a sectionInfo in print mode
    const cache = plugin.bibManager.getCacheForPath(ctx.sourcePath);
    let sectionCites = sectionInfo
      ? plugin.bibManager.getCitationsForSection(
          ctx.sourcePath,
          sectionInfo.lineStart,
          sectionInfo.lineEnd
        )
      : cache?.citations;

    if (!sectionCites?.length) return;
    
    // Sort citations by note index to ensure correct citation versions get
    // matched and filtered
    sectionCites.sort((a, b) => a.noteIndex - b.noteIndex);

    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.tagName === 'CODE') {
        continue;
      }

      let content = node.nodeValue;
      if (node.parentElement.tagName === 'A') {
        if (!plugin.settings.renderLinkCitations) continue;
        content = `[${content}]`;
      }

      let frag = createFragment();
      let pos = 0;
      let didMatch = false;

      const segments = getCitationSegments(
        content,
        !plugin.settings.renderLinkCitations
      );
      for (const match of segments) {
        if (!didMatch) didMatch = true;

        // Looks for all citations in the cache that have citekeys matching 
        // the citation segments in the current text section
        const rendered = sectionCites.find((c) =>
          equal(onlyKey(c.data), onlyKey(match))
        );

        // Drop the selected citation from the section citation array to
        // prevent the incorrect version of the citation being used
        sectionCites = sectionCites.filter((c) => 
          c.noteIndex !== rendered.noteIndex || typeof c.noteIndex === "undefined"
        );

        if (rendered) {
          const preCite = content.substring(pos, match[0].from);
          // Adds the different attributes to the citations in Preview mode
          const attr: Record<string, string> = {
            'data-citekey': rendered.citations.map((c) => c.id).join('|'),
            'data-source': ctx.sourcePath,
            'data-citetype': rendered.citations[0].citeType || 'lit',
          };

          if (rendered.note) {
            attr['data-note-index'] = rendered.noteIndex.toString();
          }

          pos = match[match.length - 1].to;

          frag.appendText(preCite);
          const span = frag.createSpan({
            attr,
            cls: getCiteClass(true, false),
          });

          if (plugin.settings.renderCitationsReadingMode) {
            if (/</.test(rendered.val)) {
              const parsed = new DOMParser().parseFromString(
                rendered.val,
                'text/html'
              );
              span.append(...Array.from(parsed.body.childNodes));
            } else {
              span.setText(rendered.val);
            }
          } else {
            span.append(node.cloneNode());
          }

          plugin.tooltipManager.bindPreviewTooltipHandler(span);

          continue;
        }

        for (let i = 0, len = match.length; i < len; i++) {
          const part = match[i];
          const next = match[i + 1];
          frag.appendText(content.substring(pos, part.from));
          pos = part.to;

          switch (part.type) {
            case SegmentType.key: {
              const { isResolved, isUnresolved } =
                plugin.bibManager.getResolution(ctx.sourcePath, part.val) || {
                  isResolved: false,
                  isUnresolved: false,
                };

              frag.createSpan({
                cls: getCiteClass(isResolved, isUnresolved),
                text: part.val,
                attr: {
                  'data-citekey': part.val,
                  'data-source': ctx.sourcePath,
                },
              });
              continue;
            }
            case SegmentType.at: {
              const { isResolved, isUnresolved } =
                plugin.bibManager.getResolution(ctx.sourcePath, next?.val) || {
                  isResolved: false,
                  isUnresolved: false,
                };

              const classes: string[] = [part.type];

              if (isUnresolved) classes.push('is-unresolved');
              if (isResolved) classes.push('is-resolved');

              frag.createSpan({
                cls: `pandoc-citation-formatting ${classes.join(' ')}`,
                text: part.val,
              });
              continue;
            }
            case SegmentType.curlyBracket:
            case SegmentType.bracket:
            case SegmentType.separator:
            case SegmentType.suppressor:
            case SegmentType.prefix:
            case SegmentType.suffix:
            case SegmentType.locator:
            case SegmentType.locatorLabel:
            case SegmentType.locatorSuffix:
              frag.createSpan({
                cls: `pandoc-citation-formatting ${part.type}`,
                text: part.val,
              });
              continue;
          }
        }
      }

      if (didMatch) {
        // Add trailing text
        frag.appendText(content.substring(pos));
        toRemove.push(node);
        node.parentNode.insertBefore(frag, node);
        frag = null;
      }
    }

    toRemove.forEach((n) => n.parentNode.removeChild(n));
  };
}
