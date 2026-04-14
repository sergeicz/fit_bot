import { InlineKeyboard } from 'grammy';

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://fit.pushkarev.online';

export function mainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚖️ Внести вес', 'action:log_weight')
    .text('🍽️ Питание', 'action:food_menu')
    .row()
    .text('🏋️ Тренировка', 'action:workout_menu')
    .text('📊 Итог дня', 'action:daily_summary')
    .row()
    .text('🚶 Шаги', 'action:log_steps')
    .text('📖 Рецепты', 'action:recipes_menu')
    .row()
    .webApp('📈 Прогресс', WEBAPP_URL);
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🏠 Меню', 'action:main_menu');
}

export function weightActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Добавить ещё', 'action:log_weight')
    .text('🏠 Меню', 'action:main_menu');
}
