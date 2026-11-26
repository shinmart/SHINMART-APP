# SPEC_APP — методы `google.script.run`

**Вызов:** `run('имя', p)` → `{ ok: true, … }` или исключение с `error`.
**Доступ:** все методы через `appGuard_`: аккаунт должен быть в
`APP_ALLOWED` и иметь права на таблицу. **Запись** принимает `reqId`.
**Роли:** `owner` (по умолчанию), `seller` (колонки H–I листа `НАСТРОЙКИ`).
Продавцу из любых ответов вычищаются `b`, `kv`, `c`, `m`, `cost`, `margin`,
`profit` (`opsScrub_`).

## Склад и продажи (`WebApp.gs`)

| Метод | Параметры | Ответ | Кто |
|-------|-----------|-------|-----|
| `appInit` / `appRefresh` | `date` | `items`, `meta`, `sales`, `role`, `dump` | все |
| `appGetSales` | `date` | `sales` дня | все |
| `appAddSale` | `size,name,qty,price,pay,date,reqId` | `row`, индекс | все |
| `appFinishSale` | `keys,rows,date` | индекс (пересчёт FIFO) | все |
| `appUndoSale` | `row,date,reqId` | индекс | все |
| `appAddPurchase` / `appUndoPurchase` | см. код | индекс | все |
| `appAddReturn`, `appAddWriteoff`, `appApplyInventory` | см. код | индекс | все |
| `appStats` | `from,to` | итоги за период | owner |
| `appAbc` | `days` | ABC-анализ | owner |

## Деньги (`Ops.gs`, `WebApp.gs`)

| Метод | Параметры | Ответ | Кто |
|-------|-----------|-------|-----|
| `appOpsInit` | — | `role`, `pays[{n,fee,days,acc}]`, `cats`, `accs[{n,t,bal}]` (только owner) | все |
| `appSaveSettings` | `pays`, `cats`, `reqId` | `pays`, `cats` | owner |
| `appAddAccount` | `n`, `t`, `bal`, `reqId` | `accs` | owner |
| `appTransfer` | `from,to,sum,date?,note?,reqId` | `accs` | owner |
| `appAdjustAccount` | `acc`, `fact`, `reqId` | `accs`, `diff` | owner |
| `appAddExpense` | `cat,sum,note,date,acc?,file?,from,to,reqId` | `row`, `exp` | owner |
| `appUndoExpense` | `row,from,to,reqId` | `exp` | owner |
| `appGetExpenses` | `from,to` | `exp{sum,cats,rows}` | owner |
| `appBankInfo` | `from,to` | `fee`, `pays[{n,s,fee}]`, `pending{sum,fee,items}` | owner |
| `appDumpList` | — | `dump[{row,k,s,n,stop,price,start,st,o}]` | все |
| `appDumpSet` | `size,name,stop,price?,reqId` | `dump` | owner |
| `appDumpClear` | `row,reqId` | `dump` | owner |
| `appUploadFile` | `b64,mime,kind,reqId` | `url`, `name` | все |

## Ошибки

Ответ `ok:false, error` — текст причины по-русски («Укажите сумму расхода.»,
«Это действие доступно только владельцу.», «Таблица занята другой записью…»).
Прочие сбои — сообщение исключения.

## Запрошено / планы

| Что | Зачем | Статус |
|-----|-------|--------|
| Автопроводка продажи в `ДВИЖЕНИЕ_ДЕНЕГ` по способу оплаты | остатки счетов без ручной сверки | этап 2 |
| Методы закупок с балансом поставщиков | долги и предоплаты | этап 2 |
