/**
 * Mentor system_prompt 模板渲染。变量格式 {var_name}。
 */
export function renderMentorPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
