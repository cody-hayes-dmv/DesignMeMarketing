-- Fix typo in onboarding templates/tasks: "clawed" -> "Claude"
-- This updates existing DB rows so the UI shows the correct title.

UPDATE `onboarding_tasks`
SET `title` = 'Set up Claude project'
WHERE `title` = 'Set up clawed project';

-- Also fix any already-created tasks that were generated from the template
UPDATE `tasks`
SET `title` = 'Set up Claude project'
WHERE `title` = 'Set up clawed project';

