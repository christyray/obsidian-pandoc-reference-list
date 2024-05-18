import { locatorToTerm, locators } from './locators';

export enum SegmentType {
  at = 'at',
  key = 'key',
  curlyBracket = 'curlyBracket',

  // In brackets
  suppressor = 'suppressor',
  bracket = 'bracket',
  prefix = 'prefix',
  suffix = 'suffix',
  locatorSuffix = 'locatorSuffix',
  locator = 'locator',
  locatorLabel = 'locatorLabel',
  separator = 'separator',

  // Citations in internal links
  litNote = 'litNote',
  linkSeparator = 'linkSeparator',

  // Pandoc crossref citations
  citeType = 'citeType',
  typeSeparator = 'typeSeparator',
}

export interface Segment {
  type: SegmentType;
  from: number;
  to: number;
  val: string;
}

interface State {
  inBrackets: boolean;
  inExplicitKey: boolean;
  inExplicitLocator: boolean;
  inKey: boolean;
  inLink: boolean;
  inSuffix: boolean;
  seekingSuffix: boolean;
  seekingLocator: boolean;
  encounteredKey: boolean;
  shouldCancelSeek: boolean;
  segment: Segment[];
  currentSegment: Segment;
  bracketDepth: number;
}

function newState(): State {
  return {
    bracketDepth: 0,
    inBrackets: false,
    inKey: false,
    inExplicitKey: false,
    inExplicitLocator: false,
    inSuffix: false,
    inLink: false,
    seekingSuffix: false,
    seekingLocator: false,
    encounteredKey: false,
    shouldCancelSeek: false,
    segment: [] as Segment[],
    currentSegment: null as Segment,
  };
}

const alphaNumeric = /[\p{L}\p{N}]/u;
const punct = /[:.#$%&\-+?<>~_/]/;
const nonKeyPunct = /\p{P}/u;
const space = /[ \t\v]/;
// Added the link separator | to the list of valid symbols before a citation key
const preKey = /[ \t\v[\-\r\n;|]/;
// postKeyPunct defines the symbols that are allowed to occur after valid bare citations
const postKeyPunct = /[.?,;):]/;
const locatorRe =
  /^((?:[[(]?[a-z\p{N}]+[\])]?[-—:][[(]?[a-z\p{N}]+[\])]?|[a-z\p{N}()[\]]*\p{N}+[a-z\p{N}()[\]]*|[mdclxvi]+)(?:[ \t]*,[ \t]*(?:[[(]?[a-z\p{N}]+[\])]?[-—:][[(]?[a-z\p{N}]+[\])]?|[a-z\p{N}()[\]]*\p{N}+[a-z\p{N}()[\]]*|[mdclxvi]+))*)/iu;
// Defines the crossref-style citation types
const citeTypes = /(fig|tbl|eq|sec)/;

function isTerminus(s?: string) {
  return !s || s === '\r' || s === '\n';
}

function isValidPreKey(s?: string) {
  return !s || preKey.test(s);
}

// Added litNote and citeType to the citation segment data
export function getSegmentData(segments: Segment[]) {
  let key: string;
  let locator: string;
  let locatorLabel: string;
  let prefix: string;
  let suffix: string;
  let litNote: string;
  let citeType: string;

  for (const seg of segments) {
    if (seg.type === SegmentType.prefix) {
      prefix = seg.val;
      continue;
    }

    if (seg.type === SegmentType.litNote) {
      litNote = seg.val;
      continue;
    }

    if (seg.type === SegmentType.citeType) {
      citeType = seg.val;
      continue;
    }

    if (seg.type === SegmentType.locator) {
      locator = seg.val;
      suffix = '';
      continue;
    }

    if (seg.type === SegmentType.locatorLabel) {
      locatorLabel = seg.val;
      continue;
    }

    if (seg.type === SegmentType.key) {
      key = seg.val;
      continue;
    }

    if (seg.type === SegmentType.suffix) {
      suffix = seg.val;
      continue;
    }
  }

  return {
    key,
    locator,
    locatorLabel,
    prefix,
    suffix,
    litNote,
    citeType,
  };
}

const parsePossibleLocator = (state: State) => {
  const match = state.currentSegment.val.match(locators);
  const segments: Segment[] = [];
  if (match) {
    const sp0 = match[1];
    const label = match[2];
    const sp1 = match[3];
    let index = state.currentSegment.from;

    if (sp0) {
      segments.push({
        from: index,
        to: index + sp0.length,
        val: sp0,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp0.length;
    }

    segments.push({
      from: index,
      to: index + label.length,
      val: label,
      type: SegmentType.locatorLabel,
    });
    index = index + label.length;

    if (sp1) {
      segments.push({
        from: index,
        to: index + sp1.length,
        val: sp1,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp1.length;
    }

    const sliced = state.currentSegment.val.slice(
      match.index + match[0].length
    );
    const locMatch = sliced.match(locatorRe);
    if (locMatch) {
      const loc = locMatch[1];
      segments.push({
        from: index,
        to: index + loc.length,
        val: loc,
        type: SegmentType.locator,
      });
      index = index + loc.length;

      const suffix = sliced.slice(locMatch.index + locMatch[0].length);
      if (suffix) {
        segments.push({
          from: index,
          to: index + suffix.length,
          val: suffix,
          type: SegmentType.suffix,
        });
      }
    } else {
      return [];
    }
  }
  return segments;
};

const parseExplicitLocator = (state: State) => {
  const match = state.currentSegment.val.match(locators);
  const segments: Segment[] = [];
  if (match) {
    const sp0 = match[1];
    const label = match[2];
    const sp1 = match[3];
    let index = state.currentSegment.from;

    if (sp0) {
      segments.push({
        from: index,
        to: index + sp0.length,
        val: sp0,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp0.length;
    }

    segments.push({
      from: index,
      to: index + label.length,
      val: label,
      type: SegmentType.locatorLabel,
    });
    index = index + label.length;

    if (sp1) {
      segments.push({
        from: index,
        to: index + sp1.length,
        val: sp1,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp1.length;
    }

    const sliced = state.currentSegment.val.slice(
      match.index + match[0].length
    );
    if (sliced) {
      segments.push({
        from: index,
        to: index + sliced.length,
        val: sliced,
        type: SegmentType.locator,
      });
    } else {
      return [];
    }
  } else {
    state.currentSegment.type = SegmentType.locator;
  }
  return segments;
};

// Added litNote and citeType to the citation data
export interface Citation {
  prefix?: string;
  suffix?: string;
  infix?: string;
  locator?: string;
  label?: string;
  litNote?: string;
  citeType?: string;
  'suppress-author'?: boolean;
  'author-only'?: boolean;
  composite?: boolean;
  id: string;
}

export interface CitationGroup {
  data: Segment[];
  citations: Citation[];
  from: number;
  to: number;
}

export interface RenderedCitation extends CitationGroup {
  val: string;
  noteIndex?: number;
  note?: string;
}

export function getCitations(
  segments: Segment[],
  locale: string = 'en-US'
): CitationGroup {
  const cites: Citation[] = [];

  let key: string;
  let prefix: string;
  let suffix: string;
  let infix: string;
  let locator: string;
  let label: string;

  // Adding extra fields to the citation for literature note paths and citation types
  let litNote: string;
  let citeType: string;

  let suppressAuthor = false;
  let onlyAuthor = false;
  let composite = false;

  const push = () => {
    const cite: Citation = {
      id: key,
    };

    if (prefix?.trim()) cite.prefix = prefix.trim();
    if (suffix?.trim()) cite.suffix = suffix.trim();
    if (infix?.trim()) cite.infix = infix.trim();
    if (litNote?.trim()) cite.litNote = litNote.trim();
    if (citeType?.trim()) cite.citeType = citeType.trim();
    if (locator) cite.locator = locator;
    if (label && locatorToTerm[locale] && locatorToTerm[locale][label]) {
      cite.label = locatorToTerm[locale][label];
    }
    if (composite) cite.composite = composite;
    else if (suppressAuthor) cite['suppress-author'] = suppressAuthor;
    else if (onlyAuthor) cite['author-only'] = onlyAuthor;

    composite = false;
    onlyAuthor = false;
    suppressAuthor = false;

    cites.push(cite);
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    switch (seg.type) {
      case SegmentType.at:
        if (i === 0) {
          composite = true;
        }
        continue;
      case SegmentType.suppressor:
        if (composite) {
          suffix = undefined;
          locator = undefined;
          label = undefined;
          composite = false;
          onlyAuthor = true;
          push();
        }
        suppressAuthor = true;
        continue;
      case SegmentType.separator:
        push();
        prefix = undefined;
        suffix = undefined;
        locator = undefined;
        label = undefined;
        infix = undefined;
        litNote = undefined;  // Citation groups will not have lit note links
        onlyAuthor = false;
        suppressAuthor = false;
        composite = false;
        continue;
      case SegmentType.key:
        key = seg.val;
        continue;
      case SegmentType.prefix:
        prefix = seg.val;
        continue;
      case SegmentType.suffix:
        suffix = seg.val;
        continue;
      case SegmentType.locator:
        locator = seg.val;
        continue;
      case SegmentType.locatorLabel:
        label = seg.val;
        continue;
      // Adding the values for the literature note path and citation type to
      // the citation; using composite = true treats the citation as bare 
      // (i.e., no brackets or parentheses)
      case SegmentType.litNote:
        litNote = seg.val;
        composite = true;
        continue;
      case SegmentType.citeType:
        citeType = seg.val;
        continue;
    }
  }

  push();

  return {
    data: segments,
    citations: cites,
    from: segments[0].from,
    to: segments[segments.length - 1].to,
  };
}

export function getCitationSegments(str: string, ignoreLinks: boolean = false) {
  const segments: Segment[][] = [];

  let state: State = null;
  let seekState: State = null;

  const endSegment = () => {
    if (state.encounteredKey) {
      segments.push(state.segment);
    }
    state = null;
  };

  const newCurrent = (i: number, c: string, type: SegmentType): Segment => {
    return {
      from: i,
      to: i + 1,
      val: c,
      type: type,
    };
  };

  const endCurrent = (i: number) => {
    if (state.seekingLocator || seekState?.seekingLocator) {
      if (state.currentSegment.type === SegmentType.suffix) {
        const segments = parsePossibleLocator(state);
        if (segments.length) {
          state.segment.push(...segments);
          state.seekingLocator = false;
          return;
        }
      } else if (state.currentSegment.type === SegmentType.locatorSuffix) {
        const segments = parseExplicitLocator(state);
        if (segments.length) {
          state.segment.push(...segments);
          state.seekingLocator = false;
          return;
        }
      }
    }

    state.currentSegment.to = i;
    state.segment.push(state.currentSegment);
  };

  for (let i = 0, len = str.length + 1; i < len; i++) {
    const prev = str[i - 1];
    const c = str[i];
    const next = str[i + 1];

    if (c === '[') {
      if (next === '[' && !state) continue;
      if (state) state.bracketDepth++;
      if (!state || state.bracketDepth === 1) {
        if (state?.seekingSuffix) {
          seekState = state;
        }
        state = newState();
        state.bracketDepth = 1;
        state.currentSegment = newCurrent(i, c, SegmentType.bracket);
        state.inBrackets = true;
        if (prev === '[') state.inLink = true;
        continue;
      }
    }

    if (c === '@' && isValidPreKey(prev)) {
      if (seekState && state.shouldCancelSeek) {
        segments.push(seekState.segment);
        seekState = null;
      }

      if (state?.inBrackets) {
        endCurrent(i);
      } else {
        state = newState();
      }

      state.currentSegment = newCurrent(i, c, SegmentType.at);
      state.inKey = true;
      state.encounteredKey = true;
      continue;
    }

    if (state?.seekingSuffix && !space.test(c)) {
      endSegment();
      continue;
    }

    if (state?.inKey) {
      if (isTerminus(c)) {
        if (!state.inBrackets) {
          endCurrent(i);
          endSegment();
        }
        state = null;
        continue;
      }

      // For crossref-style citations, the citekey begins after the citation 
      // type label with a colon
      if (prev === '@' || prev === ':') {
        if (alphaNumeric.test(c) || c === '_') {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.key);
          continue;
        }

        if (c === '{') {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
          state.inExplicitKey = true;
          continue;
        }

        state = null;
        continue;
      }

      if (state.inExplicitKey && c !== '}') {
        if (state.currentSegment.type !== SegmentType.key) {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.key);
          continue;
        }
        state.currentSegment.val += c;
        continue;
      }

      if (c === '}') {
        endCurrent(i);
        state.inKey = false;
        state.inExplicitKey = true;
        state.seekingLocator = true;
        if (!state.inBrackets) {
          state.segment.push(newCurrent(i, c, SegmentType.curlyBracket));
          state.seekingSuffix = true;
          state.shouldCancelSeek = true;
        } else {
          state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
          state.inSuffix = true;
        }
        continue;
      }

      if (c === '{') {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
        state.inKey = false;
        state.inSuffix = true;
        state.seekingLocator = true;
        state.inExplicitLocator = true;
        continue;
      }

      if (alphaNumeric.test(c)) {
        state.currentSegment.val += c;
        continue;
      }

      if (space.test(c)) {
        endCurrent(i);
        state.inKey = false;
        state.seekingLocator = true;

        if (!state.inBrackets) {
          state.seekingSuffix = true;
          state.shouldCancelSeek = true;
        } else {
          state.currentSegment = newCurrent(i, c, SegmentType.suffix);
          state.inSuffix = true;
        }
        continue;
      }

      if (punct.test(c)) {
        if (isTerminus(next)) {
          if (!state.inBrackets) {
            endCurrent(i);
            endSegment();
          }
          state = null;
          continue;
        }

        // If the previous string is one of the crossref citation types
        if (citeTypes.test(state.currentSegment.val)) {
          // Change the type of the previous text to citeType and end the segment
          state.currentSegment.type = SegmentType.citeType;
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.typeSeparator);
          continue;
        }

        if (next && punct.test(next)) {
          // Double punct
          endCurrent(i);
          state.inKey = false;
          if (!state.inBrackets) {
            endSegment();
          } else {
            state.currentSegment = newCurrent(i, c, SegmentType.suffix);
            state.inSuffix = true;
            state.seekingLocator = true;
          }
          continue;
        }

        if (space.test(next)) {
          // Treat the segment as a valid citation if the punctuation is a valid
          // post-key punctuation type and the citation is bare
          if (!state.inBrackets && postKeyPunct.test(c)) {
            endCurrent(i);
            endSegment();
          } else if (!state.inBrackets) {
            endSegment();
          } else {
            endCurrent(i);
            state.inKey = false;
            state.currentSegment = newCurrent(i, c, SegmentType.suffix);
            state.inSuffix = true;
            state.seekingLocator = true;
          }
          continue;
        }

        state.currentSegment.val += c;
        continue;
      }

      if (!state.inBrackets) {
        if (nonKeyPunct.test(c)) {
          endCurrent(i);
          endSegment();
        }
        state = null;
        continue;
      }
    }

    if (state?.inBrackets) {
      if (isTerminus(c)) {
        state = null;
        continue;
      }

      if (c === ']') {
        state.bracketDepth--;
        if (state.bracketDepth === 0) {
          if (ignoreLinks) {
            if (state.inLink || next === '(') {
              state = null;
              seekState = null;
              continue;
            }
          }

          endCurrent(i);
          state.segment.push(newCurrent(i, c, SegmentType.bracket));

          if (!seekState) {
            endSegment();
          } else {
            seekState.segment.push(...state.segment);
            segments.push(seekState.segment);
            seekState = null;
            state = null;
          }
          continue;
        }
      }

      if (c === ';') {
        state.shouldCancelSeek = false;
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.separator);
        continue;
      }

      if (c === '-' && next === '@') {
        state.shouldCancelSeek = false;
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.suppressor);
        continue;
      }

      // If a vertical bar is found before an @, the previous text is the path to the literature note
      if (c === '|' && next === '@') {
        // shouldCancelSeek = true would indicate that the current citation is complete
        state.shouldCancelSeek = false; 
        // Change the type of the previous text to litNote and end the segment
        state.currentSegment.type = SegmentType.litNote;
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.linkSeparator);
        continue;
      }

      if (c === '{') {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
        if (seekState?.seekingLocator) {
          state.inExplicitLocator = true;
        }
        continue;
      }

      if (c === '}') {
        if (
          state.inExplicitLocator &&
          state.currentSegment.type === SegmentType.suffix
        ) {
          state.currentSegment.type = SegmentType.locatorSuffix;
          state.seekingLocator = false;
        }
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
        continue;
      }

      if (prev === '{') {
        endCurrent(i);
        if (state.seekingLocator && state.encounteredKey) {
          state.currentSegment = newCurrent(i, c, SegmentType.locatorSuffix);
        } else {
          state.currentSegment = newCurrent(i, c, SegmentType.suffix);
        }
        state.inSuffix = true;
        continue;
      }

      if (prev === '}' || prev === '{') {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.suffix);
        state.inSuffix = true;
        continue;
      }

      if (seekState) {
        if (prev === ';') {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.prefix);
          state.inSuffix = false;
          continue;
        } else if (prev === '[' && state.bracketDepth === 1) {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.suffix);
          state.inSuffix = true;
          continue;
        }
      } else {
        if (prev === '[' || prev === ';') {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.prefix);
          continue;
        }
      }

      if (state.inKey) {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.suffix);
        state.inSuffix = true;
        state.inKey = false;
        state.seekingLocator = true;
        continue;
      }

      state.currentSegment.val += c;
      continue;
    }

    if (!state?.seekingSuffix) {
      state = null;
    }
  }

  if (state?.seekingSuffix) {
    segments.push(state.segment);
  }

  return segments;
}

// Function to build the rendered text for crossref-style citations (figures, 
// equations, tables, and sections)
export function renderCrossrefType(group: CitationGroup[]) {
  // Specifying the return variable object type
  const cites: RenderedCitation[] = [];

  // Label will be the rendered label for the citation type, and the other 
  // variables set up the full concatenated citation
  let label: string;
  const citeOpen = "[";
  const citeClose = "]";
  const citeJoin = ", ";

  // Builds a RenderedCitation object from the existing citation data and the 
  // newly generated label
  // This is essentially a local function to use just inside this function
  const buildCite = (citeLabel: string, group: CitationGroup) => {
    const cite: RenderedCitation = {
      data: group.data,
      citations: group.citations,
      from: group.from,
      to: group.to,
      val: citeLabel,
    };

    // Concatenates the current citation to the array of rendered citations for
    // the function output
    cites.push(cite);
  };

  // Filters the citation list to just the crossref-style citations
  const citeTypes = /(fig|tbl|eq|sec)/;
  const crossrefType = group.filter((s) =>
    s.citations.some((c) => {
      const matchType = citeTypes.test(c.citeType);
      return matchType;
    })
  );

  // For each crossref-style citation, builds the full citation label from the 
  // citation type and the citekey; joins together multiple citekeys if it is a
  // citation group
  for (let i = 0; i < crossrefType.length; i++) {
    const citation = crossrefType[i];
    switch (citation.citations[0].citeType) {
      case "fig":
        if (citation.citations.length > 1) {
          label = "Figures ";
        } else {
          label = "Figure ";
        }
        break;
      case "eq":
        if (citation.citations.length > 1) {
          label = "Equations ";
        } else {
          label = "Equation ";
        }
        break;
      case "tbl":
        if (citation.citations.length > 1) {
          label = "Tables ";
        } else {
          label = "Table ";
        }
        break;
      case "sec":
        if (citation.citations.length > 1) {
          label = "Sections ";
        } else {
          label = "Section ";
        }
        break;
    }

    const citeId = citation.citations.map((c) => c.id).join(citeJoin);
    const citeLabel = citeOpen + label + citeId + citeClose;

    // Call the local function to build the RenderedCitation object from the
    // existing citation and the new citation label
    buildCite(citeLabel, citation);
  }

  // Returns the array of rendered citations
  return cites;
}
