// Mirrors gaojing/lib/rubric.ts (the web app). Keep the picker options here in sync
// with that file by hand — this extension has no build-time link to the web repo.

export const DISCIPLINES = [{ value: '地理科学', label: '地理科学（试点）' }];

export const TARGET_JOURNALS: Record<string, string[]> = {
  地理科学: [
    'Nature Geoscience',
    'Nature Communications',
    'Earth-Science Reviews',
    'Geophysical Research Letters',
    'Journal of Geophysical Research: Earth Surface',
    'Remote Sensing of Environment',
    'Journal of Geographical Sciences',
    '地理学报',
    '地理研究',
    'Progress in Physical Geography',
  ],
};

export type Dimension = { key: string; label: string };

export type SectionConfig = {
  key: string;
  label: string;
  dimensions: Dimension[];
};

export const SECTIONS: SectionConfig[] = [
  {
    key: 'abstract',
    label: '摘要',
    dimensions: [
      { key: 'completeness', label: '信息完整度' },
      { key: 'salience', label: '核心发现显著度' },
      { key: 'concision', label: '语言凝练度' },
    ],
  },
  {
    key: 'introduction',
    label: '引言片段',
    dimensions: [
      { key: 'logic', label: '逻辑铺垫紧凑度' },
      { key: 'evidence', label: '文献证据充分性' },
      { key: 'language', label: '语言地道程度' },
    ],
  },
  {
    key: 'methods',
    label: '方法片段',
    dimensions: [
      { key: 'rigor', label: '方法严谨度' },
      { key: 'reproducibility', label: '可复现性描述' },
      { key: 'precision', label: '术语与参数精确度' },
    ],
  },
  {
    key: 'results',
    label: '结果片段',
    dimensions: [
      { key: 'objectivity', label: '结果陈述客观性' },
      { key: 'support', label: '数据支撑充分度' },
      { key: 'precision', label: '量化表达精确度' },
    ],
  },
  {
    key: 'discussion',
    label: '讨论片段',
    dimensions: [
      { key: 'depth', label: '阐释深度' },
      { key: 'engagement', label: '文献对话与证据整合' },
      { key: 'candor', label: '局限性坦诚度' },
    ],
  },
  {
    key: 'cover_letter',
    label: 'Cover Letter',
    dimensions: [
      { key: 'fit', label: '期刊定位契合度' },
      { key: 'novelty', label: '创新性表达清晰度' },
      { key: 'tone', label: '语言得体度' },
    ],
  },
  {
    key: 'highlights',
    label: 'Highlights',
    dimensions: [
      { key: 'conciseness', label: '简洁凝练度' },
      { key: 'salience', label: '创新点显著度' },
      { key: 'precision', label: '关键词精准度' },
    ],
  },
];

export function getSection(key: string): SectionConfig {
  return SECTIONS.find((s) => s.key === key) ?? SECTIONS[1];
}
