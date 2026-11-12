import { Volume2 } from 'lucide-react';
import type { DictionaryBlock, DictionaryEntry, DictionaryMatch } from '../core/dictionaries/types';
import type { PronunciationController } from '../core/usePronunciation';

export function isMeikyo(entry: DictionaryEntry) {
  // Earlier imports stored paired text and labels but did not record the format.
  return (
    entry.format === 'meikyo' ||
    entry.blocks.some(
      (block) => block.context || block.label || block.kind === 'example' || (block.ja && block.zh),
    )
  );
}

function groupsOf(blocks: DictionaryBlock[]) {
  const groups: { context: string; senses: DictionaryBlock[][] }[] = [];
  let previous: DictionaryBlock | undefined;
  for (const block of blocks) {
    if (!previous || block.context !== previous.context) {
      groups.push({ context: block.context, senses: [] });
      previous = undefined;
    }
    const group = groups.at(-1)!;
    if (
      !previous ||
      (block.sense !== undefined ? block.sense !== previous.sense : block.kind === 'definition')
    ) {
      group.senses.push([]);
    }
    group.senses.at(-1)!.push(block);
    previous = block;
  }
  let number = 0;
  const numberedGroups = groups.map(({ context, senses }) => ({
    context,
    senses: senses.map((blocks) => ({
      blocks,
      number: blocks.some((block) => block.kind === 'definition') ? ++number : undefined,
    })),
  }));
  return { groups: numberedGroups, hasMultipleSenses: number > 1 };
}

export function MeikyoMeanings({
  matches,
  speech,
}: {
  matches: DictionaryMatch[];
  speech: PronunciationController;
}) {
  return (
    <details className="meaning-language" open>
      <summary>
        <h4>词典释义</h4>
        <span className="definition-source">{matches[0].dictionary.title}</span>
      </summary>
      {matches.map(({ entry, via }) => {
        const { groups, hasMultipleSenses } = groupsOf(entry.blocks);
        return (
          <div className="imported-entry" key={entry.id}>
            <p className="imported-heading" lang="ja">
              {entry.heading}
            </p>
            {via && <p className="sense-note">{via}；以下保留目标词条的解释和限制。</p>}
            {groups.map(({ context, senses }, groupIndex) => (
              <div className="imported-sense-group" key={groupIndex}>
                {context && (
                  <h5 className="imported-context" lang="ja">
                    {context}
                  </h5>
                )}
                <ol className="imported-senses">
                  {senses.map(({ blocks, number }, senseIndex) => (
                    <li className="imported-sense" key={senseIndex}>
                      {hasMultipleSenses && number !== undefined && (
                        <h6 className="imported-sense-title">释义 {number}</h6>
                      )}
                      {blocks.map((block, blockIndex) => {
                        const label = block.label.replace(/^[◯○①-⑳㉑-㉟㊱-㊿]+\s*/u, '').trim();
                        return (
                          <div className={`imported-block imported-${block.kind}`} key={blockIndex}>
                            {block.kind === 'definition' && label && (
                              <b className="imported-writing" lang="ja">
                                {label}
                              </b>
                            )}
                            {block.kind === 'example' &&
                              blockIndex ===
                                blocks.findIndex((item) => item.kind === 'example') && (
                                <div className="imported-example-title">例句</div>
                              )}
                            {block.ja && (
                              <p className="imported-original" lang="ja">
                                {block.ja}
                                {block.kind === 'example' && (
                                  <button
                                    className="text-button example-play"
                                    aria-label={`朗读例句 ${block.ja}`}
                                    title={speech.canPlay ? '朗读例句' : '请在设置中查看朗读方式'}
                                    disabled={!speech.canPlay}
                                    onClick={() => speech.play(block.ja)}
                                  >
                                    <Volume2 size={14} aria-hidden="true" />
                                  </button>
                                )}
                              </p>
                            )}
                            {block.zh && (
                              <p className="imported-translation" lang="zh-CN">
                                {block.zh}
                              </p>
                            )}
                            {block.en && <p lang="en">{block.en}</p>}
                          </div>
                        );
                      })}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        );
      })}
    </details>
  );
}
