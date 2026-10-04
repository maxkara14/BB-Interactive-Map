# BB Interactive Map — обновления / changelog

[Русский](#русский) · [English](#english)

## Русский

### 2.0 — предрелиз, `map_test`

Изменения относительно **1.1.0 в `main`** (базовый коммит `bfa2c73`). Дата финального выпуска пока не назначена; manifest остаётся 1.1.0 до переноса в основную ветку.

#### Карта и интерфейс

- Схема мест и проходов вместо фиксированной сетки 3×3 для новых сканов. Помещения, открытая местность, участки и проходы различаются формой; связи показывают двери, тропинки, ступени и проёмы, направление и статус.
- Масштабы «Комната / Здание» заменены на «Текущая сцена / Окрестности». Положение игрока задаётся явно и отмечается «Вы здесь».
- Названия переходов вдоль линий, направленные стрелки выбранного маршрута. Миникарта показывает ближайшие места, включая доступные через промежуточную зону.
- Перетаскиваемый виджет с миникартой и запоминанием положения. На телефоне свёрнутое состояние — квадратная кнопка; развёрнутое сохраняет миникарту. Без карты можно запустить её создание.
- Терминал и пункт в меню расширений заменены секциями настроек и виджетом. В полной карте доступны обновление, отмена, редактирование и статус «✅ Уже в памяти».
- Компактная карточка места с вкладками персонажей, предметов и проходов, раскрывающимися подробностями. Исправлены размеры окон и доступность нижних действий на телефоне.
- Цвет границы обозначает безопасность, напряжение или опасность. Открытые места используют анимированный пунктир; остальные — сплошную границу и подсветку угроз. Добавлена настройка анимаций и поддержка уменьшения движения.

#### Обновления и память

- Автообновление после ответа персонажа и перегенерации: проверка предложения либо автоматическое сохранение. Неоднозначные изменения требуют подтверждения.
- Предпросмотр различий и редактор мест, связей, персонажей, предметов, угроз и позиции игрока. Откат к одному предыдущему сохранённому снимку.
- Совместимое чтение старых карт без немедленной перезаписи; переход к новой схеме после сохранения скана. Стабильные идентификаторы для отслеживания изменений.
- Отмена генерации в карте и настройках. Отменённые и устаревшие ответы не применяются; защищены смена чата, карты и режима.
- Подсветка упоминаний с карточками описания и местоположения. Одна подсветка сущности на сообщение, включая общую обработку полного имени, имени и фамилии; поддержаны визуальные пробелы и обращения RU/EN.

#### Игровой режим

- Отдельный режим для каждого чата, вместе с классической пространственной памятью.
- Подготовка перехода по подтверждённому маршруту в черновик; отправка вручную, положение обновляется по событиям истории.
- Учёт местонахождения и владения предметами. Вещи игрока сохраняются между сценами; устаревшее окружение не копится в списках неизвестных предметов.
- Временные эффекты сцен, зон и персонажей с причиной и условием завершения. Редактирование и подтверждение неоднозначных изменений.
- Переключение обратно в классику скрывает игровые панели и контекст, сохраняя записи для возвращения.

#### Подключения и интеграции

- Полный RU/EN интерфейс с выбором языка; промпты остаются английскими, описания следуют языку чата.
- Профили Connection Manager дополнены к основному подключению и Custom API. Лимит ответа карты увеличен до 10 000 токенов.
- Сохранены автоматическая вставка памяти и ручной макрос `{{bb_map}}`; добавлен API чтения карты активного чата `BBInteractiveMap` v1.
- Переходы через Enhance Gen используют его подключение и настройки текста, с отменой, возвратом исходного черновика и защитой от позднего результата.
- Совместимые тестовые ветки Enhance и VNE добавляют собственные необязательные переключатели контекста карты для генерации текста и вариантов ответа. Эти изменения находятся в соответствующих расширениях.

### 1.1.0 — основная версия до обновления

Сканирование последних сообщений, сетка 3×3, масштабы «Комната / Здание», персонажи и объекты, обозначения угроз, сохранение памяти текущего чата, автоматическая вставка или `{{bb_map}}`, основное подключение и OpenAI-compatible Custom API.

## English

### 2.0 — preview, `map_test`

Changes from **1.1.0 on `main`** (baseline commit `bfa2c73`). The final release date is pending; the manifest remains 1.1.0 until the build moves to the main branch.

#### Map and interface

- Connected places and passages replace the fixed 3×3 grid for new scans. Rooms, outdoors, areas and corridors have distinct shapes; connections show doors, paths, stairs and openings, direction and status.
- “Room / Building” scopes become “Current scene / Surroundings”. Player position is explicit and marked “You are here”.
- Passage labels follow their lines and selected routes show travel direction. The mini-map includes nearby places reached through an intermediate place.
- A draggable floating mini-map remembers its position. On phones it collapses into a square button and expands into the mini-map. Without a map it offers creation.
- The old terminal and extension-menu entry are replaced by settings and the widget. The full map offers update, cancel, edit and “✅ Already saved” controls.
- A compact place card uses character, object and passage tabs with expandable details. Phone dialogs and bottom actions fit the viewport.
- Border colors show safety, tension and danger. Outdoors have animated dashed outlines; other places keep solid borders and glow for threats. Animation settings and reduced-motion support are added.

#### Updates and memory

- Updates after character replies and rerolls, with proposal review or automatic saving. Uncertain changes require confirmation.
- Change preview and an editor for places, connections, characters, objects, threats and player position. Rollback restores one previous saved snapshot.
- Compatible reading of old maps without immediate rewriting; a saved new scan adopts the new schematic. Stable IDs help track changes.
- Generation cancellation in the map and settings. Cancelled or stale responses are discarded; changes of chat, map and mode are guarded.
- Mention highlights with description/location cards. One highlight per entity per message; full names, first names and surnames share it. Visual spacing and RU/EN honorifics are supported.

#### Game mode

- Per-chat mode alongside classic spatial memory.
- Travel drafts along confirmed routes, sent manually; narrative events establish the updated position.
- Object location and possession tracking. Player possessions survive scene changes while obsolete surroundings stop accumulating as unknown objects.
- Temporary scene, zone and character effects with causes and end conditions, editing and review of uncertain changes.
- Switching to Classic hides game panels and context while keeping records for switching back.

#### Connections and integrations

- Complete RU/EN interface with language selection. Prompts remain English; descriptions follow the chat language.
- Connection Manager profiles join the current connection and Custom API. Map output allowance increases to 10,000 tokens.
- Automatic memory injection and the manual `{{bb_map}}` macro remain; a current-chat read-only `BBInteractiveMap` v1 API is added.
- Enhance Gen travel uses Enhance's connection and writing settings, with cancellation, original-draft restoration and stale-result protection.
- Compatible Enhance and VNE preview branches add optional map-context switches for writing and response options. Those changes live in the respective extensions.

### 1.1.0 — main version before the update

Recent-message scanning, a 3×3 grid, Room / Building scopes, characters and objects, threat indicators, current-chat memory, automatic injection or `{{bb_map}}`, the main connection and an OpenAI-compatible Custom API.
