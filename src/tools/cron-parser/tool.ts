import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Cron Parser",
  slug: "cron-parser",
  description: "Parse and explain cron expressions in plain English.",
  seoDescription:
    "Free cron expression parser and explainer. Understand cron schedules in plain English, preview upcoming run times, and validate crontab syntax. All locally in your toolbox.",
  category: "text",
  tags: ["cron", "schedule", "parse", "time", "crontab", "job-scheduler", "unix", "recurring"],
  featured: true,
  icon: "Clock",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Parsing",
      description: "Decode complex cron expressions into plain English as you type.",
    },
    {
      icon: "Calendar",
      title: "Next Executions",
      description: "See the next 5 scheduled runs with timezone-aware formatting.",
    },
    {
      icon: "Code",
      title: "Full Syntax Support",
      description: "Standard cron plus special characters like L, W, and # for DevOps workflows.",
    },
  ],
};
