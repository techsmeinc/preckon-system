# Preckon Claude Frontend Skill

Copy this folder into your Preckon repository:

```text
<repo>/
└── .claude/
    └── skills/
        └── preckon-frontend/
            └── SKILL.md
```

Claude Code can then use the skill automatically when its description matches the task, or your team can explicitly invoke:

```text
/preckon-frontend
```

Recommended companion plugin:

```text
/plugin install frontend-design@claude-plugins-official
```

The Preckon skill contains product-specific rules and should govern Preckon UI decisions.
