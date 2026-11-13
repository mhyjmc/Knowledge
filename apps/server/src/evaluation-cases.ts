// 只使用合成制度，不导入用户的真实资料。改动题库时同步修改版本号。
export const datasetVersion = '1.0';
export const documents = [
  { title: '评测报销制度', content: '报销材料必须包括发票和审批记录。报销申请必须在消费后七天内提交。本文未规定报销额度。' },
  { title: '评测请假流程', content: '请假申请需要先提交给直属主管审批，审批通过后由人事登记。' },
];
export const cases = [
  { id: 'materials', question: '报销材料有哪些？请用一句话回答并引用。', title: '评测报销制度', kind: 'answer', keywords: ['发票', '审批记录'], live: true },
  { id: 'deadline', question: '报销申请必须在消费后多久提交？请用一句话回答并引用。', title: '评测报销制度', kind: 'answer', keywords: ['七天|7天|七日|7日'], live: true },
  { id: 'missing-fact', question: '报销额度最高多少钱？请简短回答。', title: '评测报销制度', kind: 'refusal', keywords: [], live: true },
  { id: 'no-match', question: '火星飞船燃料配方', title: null, kind: 'refusal', keywords: [], live: true },
  { id: 'leave', question: '请假申请由谁审批？', title: '评测请假流程', kind: 'answer', keywords: ['直属主管'], live: false },
  // 人工认定应命中报销制度，但词项检索可能漏掉同义表达；失败应如实报告。
  { id: 'paraphrase', question: '买东西之后要在几日以内递交凭证？', title: '评测报销制度', kind: 'answer', keywords: [], live: false },
] as const;
