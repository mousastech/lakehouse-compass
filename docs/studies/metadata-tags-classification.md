# Estudo — Monitoramento por tags, classificação e qualidade de metadados

_Lakehouse Compass · 28-out-2026 · base: código do Compass + medições ao vivo no workspace de demo (fevm-moi-ai)_

## 1. Resumo

Hoje o Compass trata metadado como **"existe ou não existe"**: conta descrições preenchidas e
procura algumas chaves de tag em inglês fixas no código. As medições em fevm-moi-ai mostram três problemas:

1. **Falso negativo de domínio e certificação.** O pilar *Domains* do Genie Readiness diz "1 domínio,
   0 ativos certificados". Na prática o catálogo tem `dominio_negocio` (9 tabelas), `area_negocio`
   (3 valores), `camada=gold` e `certificado=sim`, mais `system.certification_status=certified` em
   nível de schema no `rtpa_catalog`. Nada disso é contado, porque as chaves esperadas são só
   `domain`, `owner`, `certification_status`...
2. **Existência não é qualidade.** Das 1.779 colunas com comentário, até ~10% (183 sinais, com possível sobreposição) são vazias de significado:
   repetem o nome da coluna, têm menos de 15 caracteres ou são texto padrão repetido
   ("Name of the column.", "PASS or FAIL").
3. **A camada de classificação da plataforma está fora do radar.** Governed tags, Data
   Classification (`class.*`) e políticas ABAC já têm APIs e views. O Compass só usa a tag
   como contagem e nunca cruza "dado sensível" com "dado protegido".

Proposta: evoluir em 5 frentes (§4), em 3 fases (§5). A Fase 1 corrige os falsos negativos e
entrega o monitoramento por tags sem nenhum grant novo.

## 2. Estado atual (o que o código faz)

| Onde | O que mede | Limitação |
|---|---|---|
| `collectors/governance.py` (GOV-025) | % de **tabelas** com `comment` num único catálogo → `semantic_readiness` | Só existência; não olha colunas; um catálogo |
| `collectors/genie_readiness.py` `_p_metadata` (peso 22) | 50% tabelas + 50% colunas comentadas; "tagged tables" | Só existência; contagem de tags com bug (abaixo) |
| `genie_readiness.py` `_p_domains` | chaves fixas `_DOMAIN_TAG_KEYS`/`_STEWARD_TAG_KEYS`/`_CERT_TAG_KEYS` em `table_tags`/`schema_tags` | Taxonomia fixa em inglês → falso negativo |
| `collectors/security.py` (SEC-030) | APPLY_TAG concedido amplamente | OK — é o único uso de tag como fronteira de segurança |
| `finops_recs/builder.py` (FIN-027) | `custom_tags` de billing com chaves owner/team/cost_center | Lista fixa de chaves; não reaproveita a taxonomia de UC |
| `rules/definitions/governance.yaml` GOV-016 | "Governed tags defined but never applied" | **Regra definida sem avaliador** — nunca dispara |

**Bugs e incoerências encontrados (corrigir de qualquer forma):**

- `_p_metadata` conta `COUNT(DISTINCT table_name)` sem catálogo/schema → colapsa homônimos. O sinal se chama
  "governed tag", mas `table_tags` inclui tags **não governadas**. O mesmo rótulo errado aparece no `_p_domains`.
- A capability `data_classification` é marcada AVAILABLE a partir do `information_schema` de comentários.
  O nome engana: o Data Classification real (`system.data_classification.results`) nunca é sondado.
- Há dois números de "semantic readiness" que divergem: Governance 37,2% (só tabelas, só `moi_ai_catalog`)
  contra Metadata Richness 19,9 (tabelas+colunas, todos os catálogos). A UI mostra os dois sem explicar a diferença.
- Certificação só é procurada em `table_tags`. Certificação herdada de schema ou catálogo é ignorada.
- `column_tags` e `volume_tags` não são lidos.

## 3. O que a plataforma oferece (verificado)

| Recurso | Fonte | Acesso / estado em fevm-moi-ai |
|---|---|---|
| Tags em UC (governadas ou não) | `system.information_schema.{catalog,schema,table,column,volume}_tags`; API `entity-tag-assignments` | ✅ legível. Catálogo 1 · schema 6 · tabela 38 · coluna 1 · volume 0 |
| **Governed tags** (tag policies: chave + valores permitidos + ASSIGN/MANAGE) | API `tag-policies list-tag-policies`; SQL `CREATE/ALTER GOVERNED TAG` | ✅ legível — **3.074 policies no account** (FEVM compartilhado) → filtrar pelas chaves *usadas* no workspace |
| Tags de sistema | `system.certification_status` (certified/deprecated), `class.*`, `ai.*`, `sap.PersonalData.*` | ✅ presentes como policies |
| **Data Classification** (agente LLM; resultados + auto-tag `class.*`) | `system.data_classification.results` (13 colunas: catálogo/schema/tabela/coluna, `class_tag`, `confidence` HIGH/LOW, `frequency`, `samples`) | ❌ `INSUFFICIENT_PERMISSIONS` — por padrão só account admin; **contém amostras de valores** |
| Custo da classificação | `system.billing.usage` billing origin `DATA_CLASSIFICATION` | ✅ (FinOps já lê billing) |
| **ABAC** (row filter / column mask / GRANT por tag) | `system.information_schema.abac_policy_definitions`; `SHOW [EFFECTIVE] POLICIES`; API `policies` | ⚠️ legível, mas só mostra policies onde se tem MANAGE (0 linhas aqui) |
| Uso, para priorizar | `system.access.table_lineage`, `system.query.history` | ✅ |
| Tags de compute (custo) | `system.billing.usage.custom_tags` (cluster/job tags, budget policies serverless) | ✅ — **governed tags não se aplicam a compute**; são taxonomias paralelas |

## 4. Propostas

### P1 — Perfil de taxonomia configurável _(corrige o falso negativo; base de tudo)_

Trocar as tuplas fixas por um **Tag Profile** que mapeia papéis semânticos para chaves reais:

```yaml
# config/tag_profile.yaml  (default genérico; override por target em databricks.local.yml)
roles:
  domain:        [domain, data_domain, business_domain, dominio_negocio, area_negocio, gov_data_domain]
  layer:         [layer, data_layer, camada, tier]
  owner:         [owner, data_owner, steward, data_steward, responsavel]
  certification: {keys: [system.certification_status, certification_status, certificado],
                  certified_values: [certified, sim, true, yes]}
  sensitivity:   {keys: [sensitivity, pii, classification], prefixes: ["class.", "sap.PersonalData."]}
  cost_center:   [cost_center, team, business_unit, centro_custo]   # compartilhado com FIN-027
inherit: true   # tag de catálogo/schema vale para os filhos
```

- Comparação case-insensitive e herança catálogo → schema → tabela → coluna, via uma view materializada `effective_tags`.
- **Auto-descoberta:** o scan lista as chaves mais frequentes que *não* estão no perfil e sugere o papel
  delas na UI ("`area_negocio` parece *domain* — mapear?"). Nada é aplicado sem confirmação.
- O mesmo perfil alimenta o FIN-027 (custo) e o Genie Readiness, com uma única definição de "dono".

### P2 — Monitoramento baseado em tags _(tags como dimensão de recorte)_

Hoje todo indicador é por workspace. A proposta é permitir **recortar por papel de tag**:

- **Scorecard por domínio, camada e owner:** % documentado, % certificado, % com owner, findings abertos,
  custo atribuído (UC tag ⇄ billing tag via `cost_center`), uso (consultas e usuários 30 dias).
- **Escopo de monitoramento por tag:** em Settings, "monitorar só `camada=gold`" ou "só `dominio_negocio=X`".
  As regras GOV/GEN-READY passam a avaliar dentro do escopo, o que separa a dívida de bronze do que importa.
- **Data products:** um domínio só conta como "maduro" se tiver owner, ao menos uma tabela certificada e
  descrições de qualidade (P5) nos ativos gold.
- Novo filtro global no top bar, ao lado do seletor de workspace (`?tag=role:value`, como o `?ws=`).

Novas regras: **GOV-030** gold sem owner · **GOV-031** gold não certificado · **GOV-032** ativo
`deprecated` ainda consultado (usa lineage e query.history — muito acionável) · **GOV-033** domínio sem steward.

### P3 — Higiene de tags _(governado vs. não governado)_

- **Implementar o GOV-016**: chaves governadas (policies) com 0 atribuições nos catálogos do workspace.
- **GOV-034 — drift de tag:** chave não governada que colide com uma governada ou com variações de caixa e
  grafia (`Gold`/`gold`, `data_layer`/`camada`). Recomendação: governar a chave e consolidar os valores.
- **GOV-035 — valor fora da lista permitida** (atribuições anteriores à policy, que passam a ser "governadas" com valor inválido).
- Métrica **% de atribuições governadas**, sabendo que um account compartilhado polui o denominador.
  Por isso o universo é "chaves usadas no workspace", nunca "todas as policies do account".

### P4 — Classificação de dados sensíveis e lacuna de proteção

Cruzar **onde está o dado sensível** com **o que o protege**:

```
coluna sensível (class.* | sensitivity tag | detecção Data Classification HIGH)
   ─┬─ coberta por ABAC column mask / row filter cuja WHEN casa a tag?   → protegida
    ├─ coberta por column mask direta (information_schema.column_masks)? → protegida
    └─ nenhuma                                                           → SEC-040 lacuna de proteção
```

- **SEC-040** coluna sensível sem máscara (high) · **SEC-041** detecção HIGH sem tag aplicada (auto-tagging
  desligado no catálogo) · **GOV-036** catálogo sem Data Classification habilitado · **FIN-0xx** custo de
  `DATA_CLASSIFICATION` (o scan inicial é caro).
- **Acesso honesto:** `system.data_classification.results` exige grant do account admin e **contém amostras de
  valores reais**. Regras: (a) o Compass **nunca** lê nem persiste a coluna `samples`. A query seleciona
  colunas explícitas, e isso vale como guardrail. (b) Sem grant, fica NOT_AVAILABLE com o grant exato
  (o mesmo padrão do Lakebase). (c) Fallback **rotulado como heurística**: as tags `class.*` já aplicadas
  (legíveis em `column_tags`) cobrem o caso com auto-tagging ligado, sem precisar dos resultados brutos.
- O ABAC só é visível onde o SP tem MANAGE. A tela deve dizer "N policies visíveis", nunca "não há policies".

### P5 — Qualidade de metadados _(da discussão: além da existência)_

Escada de maturidade, com cada degrau mais caro e mais preciso:

**N0 — Existência (hoje).** Comentário preenchido sim/não.

**N1 — Heurísticas determinísticas (SQL puro, custo ~0, todo o catálogo).** Já medido em fevm-moi-ai:

| Sinal | Regra | Achado (1.779 colunas comentadas) |
|---|---|---|
| Curta demais | `length < 15` | 57 |
| Eco do nome | comentário normalizado = nome da coluna | 6 |
| Abertura genérica | começa com `id|name|value|date|column|field|tbd|todo|test|n/a…` | 120 |
| Boilerplate repetido | o mesmo texto em > N colunas distintas | "Name of the column." ×6, "PASS or FAIL" ×7… |
| Placeholder / idioma | `lorem`, `xxx`, só tipo de dado; idioma diferente do padrão do domínio | — |
| Tabela sem propósito | o comentário da tabela não diz grão nem conteúdo | — |

Resultado: classe `ok / genérica / vazia_de_sentido` por objeto, e **% de descrições úteis** em vez de % preenchidas.

**N2 — Juiz LLM (amostrado e priorizado por uso).** Para os ativos que importam (gold, certificados e o
top-N por consultas e lineage em 30 dias):

- Entrada: nome qualificado, tipo, comentário, nomes das colunas vizinhas e comentário da tabela. **Nunca dados ou amostras.**
- Rubrica 0–3 em 4 critérios: **especificidade** (diz algo além do nome?), **semântica de negócio**
  (unidade, grão, regra), **correção aparente** (coerente com tipo e nome), **utilidade para o Genie**
  (desambigua sinônimos?). Saída em JSON estruturado + justificativa curta.
- Execução: `ai_query` no scan job (serverless, batch) ou o endpoint `compass-llm` já vinculado.
  Cache por `sha256(fqn + comment)`, que reavalia só o que mudou, e teto de objetos por scan.
  Custo medido via billing, como o próprio Data Classification.
- Calibração: um eval set pequeno (~50 descrições rotuladas à mão) e uma métrica de concordância antes de
  ligar como score. Isso também destrava o item adiado de "MLflow eval set".
- Um modelo ML clássico (embeddings + classificador) **não** é recomendado agora: falta rótulo e o LLM com
  rubrica já resolve. Embeddings servem para o **boilerplate semântico** (descrições diferentes que dizem o mesmo).

**N3 — Sugestão (nunca aplicação).** Para descrições ruins de ativos prioritários, o agente gera uma
descrição melhor como **ProposedChange** (`COMMENT ON COLUMN …`), que vai para a tela Changes com
aprovação. Isso segue a regra do Compass de nunca executar sozinho. Vale referenciar o "AI generate" nativo
do Catalog Explorer como alternativa para o cliente.

Novas regras: **GOV-040** descrições genéricas em ativos gold (N1) · **GOV-041** score LLM baixo em
ativos muito consultados (N2) · **GEN-READY-METADATA** passa a pesar qualidade, não só existência.

### P6 — Um único "Metadata Readiness"

Unificar GOV-025 e o pilar Metadata Richness num índice só, ponderado por uso:

```
Metadata Readiness = Σ_ativo  peso_uso(ativo) × ( 0,35·documentação_útil (N1/N2)
                                               + 0,25·classificação/sensibilidade resolvida
                                               + 0,20·owner + domínio
                                               + 0,20·certificação/camada )
```

O peso de uso vem de lineage e query.history: uma tabela gold consultada por 40 pessoas vale mais que 300
tabelas de staging. Assim o número para de punir dívida irrelevante. O `semantic_readiness` atual fica
como sub-métrica, para continuidade do histórico.

## 5. Roadmap sugerido

| Fase | Entrega | Grants novos | Esforço |
|---|---|---|---|
| **1 — Corrigir e recortar** | Bugs do §2; Tag Profile (P1) com auto-descoberta; `effective_tags` com herança; GOV-016 real; heurísticas N1; scorecard por domínio e camada (P2) | nenhum | ~1–1,5 sem |
| **2 — Classificação e proteção** | P3 completo; P4 com `class.*` + ABAC visível + NOT_AVAILABLE honesto para os resultados; regras SEC-040/041 | opcional: SELECT em `data_classification.results` (sem `samples`) | ~1 sem |
| **3 — Qualidade inteligente** | Juiz LLM N2 com cache e eval set; ProposedChange de descrições (N3); índice unificado P6 | nenhum (o endpoint já existe) | ~1,5–2 sem |

## 6. Decisões em aberto (para o usuário)

1. ~~**Perfil de taxonomia:** default genérico no repo + override por cliente em `databricks.local.yml`?~~
   **Adotado na Fase 1:** `tag_profile.yaml` genérico (en/pt/es) + var `tag_profile_json` por target.
2. **Escopo padrão do monitoramento:** tudo, ou só `layer=gold` + certificados quando existirem?
3. **Data Classification:** pedir o grant aos clientes ou ficar só com `class.*` aplicados?
4. ~~**Juiz LLM:** `ai_query` no scan job ou `compass-llm` no app?~~ **Decidido: no app (`compass-llm`).** Falta definir o teto de objetos por avaliação.
5. **Unificação P6:** substituir o Semantic Readiness atual na Overview ou mostrar os dois durante uma transição?

## Apêndice — SQL de referência (validado em fevm-moi-ai)

```sql
-- Distribuição de tags (todas, governadas ou não)
SELECT catalog_name, tag_name, tag_value, COUNT(*) n
FROM system.information_schema.table_tags GROUP BY ALL ORDER BY n DESC;

-- Heurísticas N1 sobre comentários de coluna
WITH c AS (SELECT column_name, comment FROM system.information_schema.columns
           WHERE table_schema <> 'information_schema' AND trim(comment) <> '')
SELECT COUNT(*) commented,
       SUM(CASE WHEN length(comment) < 15 THEN 1 ELSE 0 END) short_lt15,
       SUM(CASE WHEN lower(regexp_replace(comment,'[^a-zA-Z]','')) =
                     lower(regexp_replace(column_name,'[^a-zA-Z]','')) THEN 1 ELSE 0 END) echo_name
FROM c;

-- Boilerplate repetido
SELECT comment, COUNT(*) n FROM system.information_schema.columns
WHERE comment IS NOT NULL GROUP BY 1 HAVING n > 5 ORDER BY n DESC;

-- ABAC visível ao principal (só onde há MANAGE)
SELECT policy_type, COUNT(*) FROM system.information_schema.abac_policy_definitions GROUP BY 1;

-- Data Classification — NUNCA selecionar `samples`
SELECT catalog_name, schema_name, table_name, column_name, class_tag, confidence, frequency
FROM system.data_classification.results;
```

## 7. Status da Fase 1 (implementada)

| Item | Onde |
|---|---|
| Tag Profile (papéis → chaves, en/pt/es, override `tag_profile_json`, sugestão para chaves não mapeadas) | `packages/compass_core/tag_profile.{py,yaml}` |
| Tags efetivas com herança catálogo → schema → tabela (certificação **não** herda) | `collectors/metadata.py` `effective_roles_sql` |
| Heurísticas N1 de qualidade (missing / placeholder / echo / generic / short / boilerplate / useful) | `collectors/metadata.py` `quality_case_sql` |
| Scorecard por domínio, camada e owner (`tag_rollup`) + taxonomia em uso (`tag_inventory`) | scan job → Delta; tela Governance |
| Regras GOV-016 (agora avaliada), GOV-030, GOV-031, GOV-033, GOV-040 + controles WAF | `rules/definitions/governance.yaml`, `waf/catalogue/data_ai_governance.yaml` |
| Correções do §2: contagem de tags qualificada, rótulos "UC tag", capability `data_classification` real, Semantic Readiness em todos os catálogos | `genie_readiness.py`, `governance.py` |

Efeito medido no workspace de demo: o pilar *Domains & Stewardship* foi de 48 para 72 (4 domínios e 3
tabelas certificadas reconhecidos, antes 1 e 0). O Semantic Readiness passou de 37,2% (um catálogo) para
33,6% (todos os catálogos), agora coerente com o Genie Readiness. A capability `data_classification`
passou a NOT_AVAILABLE, que é o estado real sem grant.

Ficou para as próximas fases: filtro global por tag no top bar e escopo de monitoramento em Settings
(P2), GOV-032 (deprecated ainda consultado), higiene de tags (P3), lacuna de proteção (P4), juiz LLM no
app e ProposedChange de descrições (P5), índice unificado (P6).

## 8. Status da Fase 2 (implementada)

| Item | Onde |
|---|---|
| **P3 — Higiene de tags:** variantes de grafia de chave (inclui chave não governada em uso que é variante de uma governada), papel espalhado em várias chaves, variantes de valor (`Gold`/`gold`), valores fora da lista permitida (um GET por chave governada em uso), % de atribuições governadas | `collectors/metadata.py` `tag_hygiene`; regras GOV-034, GOV-035 |
| **P4 — Lacuna de proteção:** coluna sensível (tag no papel *sensitivity* ou detecção HIGH) × máscara direta (`column_masks`) × política ABAC `COLUMN_MASK` cujas `governed_tags` casam com a tag, no escopo da tabela ou de um ancestral | `collectors/protection.py` `evaluate_protection`; regra SEC-040 |
| Detecções do Data Classification sem tag (só com grant; **nunca** lê `samples`) | SEC-041 |
| Heurística de nome (email, cpf, phone, address…) **separada e rotulada**, severidade baixa, nunca alimenta a SEC-040 | SEC-042 |
| Catálogos gerenciados sem configuração de Data Classification (API `data-classification/v1/catalogs/{c}/config`; "not found" = não habilitado) | GOV-036 |
| Controle de compliance `DBX-SBP:DATA-1`; WAF `SCP-DATA-02` passou de atestação para medido | `compliance/frameworks`, `waf/catalogue` |
| UI: painel "Proteção de dados sensíveis" (Security) e card "Higiene de tags" (Governance) | `SensitiveDataPanel.tsx`, `Governance.tsx` |

Medido no workspace de demo:
- Higiene: 20% das atribuições usam chave governada. `product` está em uso sem governança, enquanto a governed `Product` existe. O papel *domain* está em 3 chaves e *layer* em 2.
- Proteção: 0 colunas com tag de sensibilidade, 265 candidatas pela heurística de nome, 6 máscaras diretas e 0 políticas ABAC visíveis. O Data Classification não está habilitado em nenhum dos 3 catálogos gerenciados.

Limites honestos:
- Políticas ABAC só aparecem onde o scan tem MANAGE; a contagem de políticas visíveis acompanha cada finding.
- Tags de sensibilidade no nível da tabela ainda não entram na SEC-040, que é por coluna.

## 9. Status da Fase 3 (implementada)

| Item | Onde |
|---|---|
| Export de candidatas: colunas comentadas das 40 tabelas prioritárias (gold ×3, certificada ×2, leitores distintos em 30 d via lineage do workspace), só metadados | `MetadataCollector._candidates` → `metadata_candidates` |
| **N2 — Juiz LLM no app** (`compass-llm`): rubrica 0–3 (especificidade, semântica de negócio, plausibilidade, utilidade p/ Genie), veredito good/weak/poor, lotes de 12 com concorrência 3, cache por hash do comentário + `PROMPT_VERSION`, comentários tratados como dado (prompt injection no eval set), INSERT 100% parametrizado | `app/server/metadata/judge.ts`, `POST /api/metadata/review` |
| **Eval set rotulado** (30 itens en/pt/es, semente) + concordância exata e binária | `POST /api/metadata/eval` |
| **N3 — Sugestão → ProposedChange** (`ALTER TABLE … ALTER COLUMN … COMMENT`, com rollback para o texto atual), aprovação na tela Changes, nunca executa | `POST /api/metadata/propose` |
| GOV-041 a partir das revisões ainda vigentes (fecha o ciclo no scan seguinte) | `review_finding` |
| **P6 — Metadata Readiness** ponderado por leitores: documentação 35% (LLM onde revisado), sensibilidade 25%, ownership 20%, curadoria 20%; por domínio | `compass_core/metadata_readiness.py` |
| Tabelas escritas pelo app (`metadata_llm_reviews`, `proposed_changes`) criadas pelo scan com `GRANT SELECT, MODIFY` só nelas ao SP do app | `run_scan._ensure_app_tables` |

Medido no workspace de demo antes de qualquer revisão: Metadata Readiness **29,3**. Os componentes:
- documentação 19,0;
- sensibilidade 88,8;
- ownership 1,4;
- curadoria 1,0.

O export trouxe 410 colunas candidatas de 40 tabelas. Revisar e medir a concordância exige CAN MANAGE no app, porque gasta tokens.
