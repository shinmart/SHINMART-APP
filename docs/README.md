# Документация

| Раздел | Что внутри |
|--------|-----------|
| [`code/nav.md`](code/nav.md) | **читать первым**: какой документ и файл открыть под задачу |
| [`code/bugfix.md`](code/bugfix.md) | как чинить баг |
| [`code/git.md`](code/git.md) | ветки, коммиты, как файлы попадают в Apps Script |
| [`code/deploy.md`](code/deploy.md) | выкладка: файлы, меню, новая версия развёртывания |
| [`code/testing.md`](code/testing.md) | как проверять сервер и интерфейс |
| [`code/migration-plan.md`](code/migration-plan.md) | переезд с Google на свой сервер |
| [`code/ui/components-map.md`](code/ui/components-map.md) | готовые элементы интерфейса |
| [`business/`](business/) | сценарии (`_template.md`), каталог функций |
| [`api/SPEC_APP.md`](api/SPEC_APP.md) | методы `google.script.run`: параметры и ответы |

Правила кода — в [`../.claude/rules/`](../.claude/rules/), подгружаются сами по
путям файлов. Порядок работы: **сценарий → контракт → код → каталог**.
