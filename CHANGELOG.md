# BB Interactive Map — обновления / changelog

[Русский](#русский) · [English](#english)

## Русский

### Исправления — 7 октября 2026 (без изменения версии)

- Включение автосохранения применяет уже готовое безопасное обновление, не удаляя его и не расходуя новый запрос. Неоднозначные изменения остаются на проверке; устаревшие результаты не сохраняются.
- Автосохранение включает подготовку обновлений после реплик. Автообновление работает и без предварительно сохранённой первой карты; ручные сканы сохраняют предпросмотр.

### 2.0.1 — 6 октября 2026

- Исправлена подсветка упоминаний в сообщениях: скрытые панели больше не забирают подсветку у видимого текста. Описательные названия персонажей вроде «Две спорящие ученицы» больше не подсвечивают отдельные обычные слова.
- Для распространённых предметов добавлены русские словоформы и однозначные короткие названия: «Медный ключ» распознаётся по «медным ключом» или «ключа». При нескольких ключах короткое упоминание пропускается; неизвестные и сложные названия по-прежнему сопоставляются целиком.
- Исправлено открытие карточек по нажатию на телефоне, включая страницы с преобразованным корневым элементом. Обработчики сообщений, постороннее выделение текста и сброс прокрутки меню больше не мешают открытию.
- Мобильные карточки стали узкими и компактными: открываются под упоминанием, а при нехватке места снизу — над ним. Сохраняются все данные и прокрутка длинного содержимого; карточка остаётся в пределах видимой области экрана.
- Изменение размера экрана больше не закрывает карточку, а прокрутка постороннего меню не мешает её чтению. Сохранено управление с клавиатуры.
- Обновлены подсказки и README на русском и английском с возможностями и ограничениями распознавания упоминаний.

### 2.0.0 — 4 октября 2026

Изменения относительно **1.1.0**.

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
- Enhance и VNE добавляют собственные необязательные переключатели контекста карты для генерации текста и вариантов ответа. Эти изменения находятся в соответствующих расширениях.

### 1.1.0 — основная версия до обновления

Сканирование последних сообщений, сетка 3×3, масштабы «Комната / Здание», персонажи и объекты, обозначения угроз, сохранение памяти текущего чата, автоматическая вставка или `{{bb_map}}`, основное подключение и OpenAI-compatible Custom API.

## English

### Fixes — October 7, 2026 (no version change)

- Enabling automatic saving applies an existing safe update without discarding it or making another request. Ambiguous changes stay available for review; stale results are not saved.
- Automatic saving enables updates after replies. Automatic updates also work before the first map has been saved; manual scans retain their preview.

### 2.0.1 — October 6, 2026

- Fixed mention highlighting: hidden panels no longer consume highlights intended for visible message text. Descriptive character labels such as «Две спорящие ученицы» no longer highlight individual common words.
- Added Russian inflections and unambiguous short names for common objects: «Медный ключ» also matches «медным ключом» or «ключа». Short mentions are skipped when multiple keys exist; unknown and complex labels still require their full name.
- Fixed tapping mention cards on phones, including pages with a transformed root element. Message handlers, unrelated text selections and menu scroll resets no longer prevent opening cards.
- Mobile cards are now narrow and compact, opening below the mention or above it when space is limited. All information remains available with internal scrolling, and cards stay within the visible viewport.
- Resizing the viewport no longer closes cards, and scrolling an unrelated menu no longer interrupts reading. Keyboard controls are preserved.
- Updated Russian and English hints and READMEs to explain mention matching and its limitations.

### 2.0.0 — October 4, 2026

Changes from **1.1.0**.

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
- Enhance and VNE add optional map-context switches for writing and response options. Those changes live in the respective extensions.

### 1.1.0 — main version before the update

Recent-message scanning, a 3×3 grid, Room / Building scopes, characters and objects, threat indicators, current-chat memory, automatic injection or `{{bb_map}}`, the main connection and an OpenAI-compatible Custom API.
