# Modules

- [安装与 CLI](install.md)
- [知识层](knowledge.md)
- [平台集成](platforms.md)
- [Trellis 迁移](migration.md)

One file per module: `modules/<name>.md`. Each file should cover:

- Purpose and boundaries (what it does and deliberately does not do)
- Key entry points and important code paths
- Dependencies on other modules / external contracts it must satisfy
- Constraints and counter-intuitive traps ("common misjudgment -> correct
  behavior -> evidence")
