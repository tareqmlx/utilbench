import Fuse from "fuse.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getIcon } from "../lib/icons";
import { getAllTools } from "../tools/registry";
import type { ToolDefinition } from "../tools/types";
import { Badge } from "./ui/badge";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { DialogDescription, DialogTitle } from "./ui/dialog";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const allTools = useMemo(() => getAllTools(), []);

  const fuse = useMemo(
    () =>
      new Fuse(allTools, {
        keys: [
          { name: "name", weight: 2 },
          { name: "description", weight: 1 },
          { name: "tags", weight: 1 },
          { name: "category", weight: 0.5 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [allTools],
  );

  const results: ToolDefinition[] = useMemo(() => {
    if (!query.trim()) return allTools;
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse, allTools]);

  // Clear query when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  const navigateToTool = useCallback(
    (slug: string) => {
      onClose();
      navigate(`/tools/${slug}`);
    },
    [navigate, onClose],
  );

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogTitle className="sr-only">Search utilities</DialogTitle>
      <DialogDescription className="sr-only">
        Find a utility by name, description, or tag.
      </DialogDescription>
      <CommandInput placeholder="Search utilities..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Tools" key={query}>
          {results.map((tool, i) => {
            const Icon = getIcon(tool.icon);
            return (
              <CommandItem
                key={tool.slug}
                value={`${tool.name} ${tool.tags.join(" ")} ${tool.category}`}
                onSelect={() => navigateToTool(tool.slug)}
                className="wb-item-enter flex items-center gap-3"
                style={{ animationDelay: `${Math.min(i * 18, 240)}ms` }}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{tool.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {tool.category}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{tool.description}</p>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
