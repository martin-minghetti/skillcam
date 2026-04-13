#!/usr/bin/env node
import { program } from "commander";

program
  .name("skillcam")
  .description("Turn successful AI agent runs into reusable markdown skills")
  .version("0.1.0");

program.parse();
