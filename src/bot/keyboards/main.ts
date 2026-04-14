import { InlineKeyboard } from 'grammy';

export function mainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚖️ Внести вес', 'action:log_weight')
    .text('🍽️ Питание', 'action:food_menu')
    .row()
    .text('🏋️ Тренировка', 'action:workout_menu')
    .text('📊 Итог дня', 'action:daily_summary')
    .row()
    .text('🚶 Шаги', 'action:log_steps')
    .text('📈 Прогресс', 'action:progress');
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🏠 Меню', 'action:main_menu');
}

export function weightActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Добавить ещё', 'action:log_weight')
    .text('🏠 Меню', 'action:main_menu');
}
