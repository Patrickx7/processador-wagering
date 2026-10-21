// contadores simples em memoria (cada instancia tem os seus)
export const metricas = {
  transacoes_processadas: 0,
  transacoes_rejeitadas: 0,
  transacoes_pendentes_referencia: 0,
  duplicatas_detectadas: 0,
  conflitos_concorrencia: 0,
  retries: 0,
  mensagens_dlq: 0,
  divergencias_reconciliacao: 0,
  latencia_total_ms: 0,
  latencia_quantidade: 0,
  latencia_maxima_ms: 0,
};

export function contar(nome: keyof typeof metricas) {
  metricas[nome]++;
}

export function registrarLatencia(inicio: number) {
  const ms = Date.now() - inicio;
  metricas.latencia_total_ms += ms;
  metricas.latencia_quantidade++;
  metricas.latencia_maxima_ms = Math.max(metricas.latencia_maxima_ms, ms);
}
