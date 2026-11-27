# Навигация по коду — читать первым

Нашёл строку своей задачи — открой указанное, остальное не читай. Строки
нет — найди через `grep` и **добавь строку сюда** в том же коммите.

## Что читать под задачу

| Задача | Сначала | Потом |
|--------|---------|-------|
| Как работает сценарий | `docs/business/<тема>.md` | `docs/api/SPEC_APP.md` |
| Новый или изменённый метод | `docs/api/SPEC_APP.md` | функция `app…` в `WebApp.gs` / `Ops.gs` |
| Продажа, отмена, FIFO | `WebApp.gs` § `appFastSale_`, `appFinishSale`, `appSaleCore_` | `Code.gs` § `recalcFifoForKeys` |
| Приход (закупка), возврат, списание, инвентаризация | `WebApp.gs` § `appPurchaseCore_`, `appAddReturn`, `appApplyInventory` | — |
| Итоги, ABC | `WebApp.gs` § `appStats`, `appAbc` | `appReadSales_` |
| Расходы | `WebApp.gs` § `appAddExpense`, `appExpenses_` | `Ops.gs` § `opsMove_` |
| Счета, переводы, комиссии, «ждём зачисления» | `Ops.gs` § `opsAccounts_`, `appTransfer`, `appBankInfo` | `НАСТРОЙКИ` |
| Слив до остатка (правило, стоп, письмо) | `Ops.gs` § `opsDumpCheck_`, `appDumpSet` | `Index.html` § `renderDump`, `drawDump` |
| Роли, скрытие себестоимости | `Ops.gs` § `opsRole_`, `opsScrub_` | `WebApp.gs` § `appGuard_` |
| Фото чеков, вложения | `Ops.gs` § `appUploadFile` | `Index.html` § `shrinkPhoto` |
| Доступ, `APP_ALLOWED` | `WebApp.gs` § начало файла, `appGuard_` | `LESSONS.md` § Доступ |
| Раскладка журнала по дням | `WebApp.gs` § `appRelayoutSales`, `appWriteDayHeader_` | L-007 |
| Зеркало в старые листы ЗАКУПКИ / ПРОДАЖИ | `Mirror.gs` § `mirrorRun`, `mirrorBuildSales_` | `tests/mirror.test.js` |
| Правка руками в таблице → приложение | `Code.gs` § `onEdit` | `Index.html` § `visibilitychange` |
| Миграция старых листов | `WebApp.gs` § `appMigrate` | — |
| Экран приложения | `Index.html` § секция экрана | `design.md` |
| Починить баг | `docs/code/bugfix.md` | `LESSONS.md` § своя область |
| Выложить | `docs/code/deploy.md` | — |

## Экраны (`Index.html`)

| Экран | Секция / функции |
|-------|------------------|
| Склад (остатки, поиск, размеры с промежутками) | `СКЛАД`: `renderList`, `renderFbar` |
| Продажа в два нажатия | `шторка`: `renderSaleSheet`, `queueFinish`, `flushFinish` |
| Журнал продаж дня | `ПРОДАЖИ`: `renderSales`, `setSalesDay` |
| Приход / возврат | `ПРИХОД` |
| Ещё: итоги, ABC, инвентаризация | `ЕЩЁ`: `showPage` → `drawStatsShell`, `drawAbcShell`, `drawInv` |
| Расходы с чеком | `drawExp`, `renderExp` |
| Счета и переводы | `drawAcc`, `renderAcc` |
| Комиссии и «ждём зачисления» | `drawBank`, `loadBank` |
| Настройки учёта | `drawCfg`, `renderCfg` |
| Роль | `loadOps` → `body.seller` |

## Листы

| Лист | Что | Пишет |
|------|-----|-------|
| `ПРОДАЖИ_ЖУРНАЛ` | продажи по дням (шапка дня — `Date` в A) | `WebApp.gs` |
| `ЗАКУПКИ` | приходы | `WebApp.gs` |
| `ОСТАТКИ` | текущие остатки и Kaspi-анализ | `Code.gs` |
| `РАСХОДЫ` | расходы (+ СЧЁТ, ЧЕК) | `WebApp.gs` |
| `НАСТРОЙКИ` | оплата и комиссии, категории, роли | `Ops.gs` |
| `СЛИВ` | правила «сливать до N шт», статус АКТИВНО / СТОП / СНЯТО | `Ops.gs` |
| `СЧЕТА` | счета и начальные остатки | `Ops.gs` |
| `ДВИЖЕНИЕ_ДЕНЕГ` | движения денег | `Ops.gs` |
| `APP_ЖУРНАЛ` | журнал действий, основа отмены | `WebApp.gs` |

## Не брать за образец

`Code.gs` — старый код таблицы (меню, Kaspi, v18): подключаемый, но новые
функции приложения туда не писать.

- Продажа пишется в блок дня старого листа ПРОДАЖИ (`appPlaceSaleRow_`): первая пустая строка до итогов; нет места — вставка внутри блока; нет блока — копия последнего. Тест: `node tests/prodaji-blocks.test.js`.

- Приход пишется в первую пустую строку-шаблон ЗАКУПКИ после последней заполненной (`appNextRow_`), формулы К..T остаются; отмена очищает только вводимые ячейки. «Сегодня» считается по поясу скрипта (`appToday_`): у таблицы пояс Катманду.

- Продажа: список позиций с кнопкой «Все позиции» и «Показать ещё», наименование крупнее размера, шипы синие / липучки красные (`sugBtn`); полоса дней `#dstrip` вместо «Сегодня/Вчера»; нижняя панель `#tabbar` (Продажа/Остатки/Закупки/Анализ, только до 1000 px); время записи продажи из APP_ЖУРНАЛ (`appLogTimes_`).
