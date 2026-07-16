import React, { useState, useMemo, useEffect } from 'react';
import { Icon } from '@iconify/react';

function buildFileTree(files) {
  const root = { name: 'root', path: '', children: {}, type: 'dir', linesAdded: 0, linesRemoved: 0 };

  files.forEach(file => {
    const parts = file.path.split('/');
    let current = root;

    let linesAdded = 0;
    let linesRemoved = 0;
    file.hunks.forEach(hunk => {
      hunk.lines.forEach(line => {
        if (line.type === 'add') linesAdded++;
        if (line.type === 'del') linesRemoved++;
      });
    });

    root.linesAdded += linesAdded;
    root.linesRemoved += linesRemoved;

    parts.forEach((part, index) => {
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          type: index === parts.length - 1 ? 'file' : 'dir',
          children: {},
          linesAdded: 0,
          linesRemoved: 0,
        };
      }
      current.children[part].linesAdded += linesAdded;
      current.children[part].linesRemoved += linesRemoved;
      current = current.children[part];
    });
  });

  // Convert children objects to sorted arrays
  function sortNode(node) {
    if (node.type === 'file') return node;
    const childrenArray = Object.values(node.children);
    childrenArray.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children = childrenArray;
    childrenArray.forEach(sortNode);
    return node;
  }

  return sortNode(root);
}

function TreeNode({ node, level, activeFile, onSelectFile, expandedPaths, toggleExpand }) {
  const isExpanded = expandedPaths.has(node.path);
  const isActive = activeFile === node.path;
  const isDir = node.type === 'dir';

  const handleClick = (e) => {
    e.stopPropagation();
    if (isDir) {
      toggleExpand(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <div>
      <div 
        onClick={handleClick}
        className={`flex items-center group cursor-pointer text-[13px] py-1 px-2 rounded-md ${
          isActive 
            ? 'bg-brand-50 text-brand-700 font-medium' 
            : 'text-slate-700 hover:bg-slate-100'
        }`}
        style={{ paddingLeft: `${(level * 12) + 8}px` }}
      >
        <span className="w-4 h-4 flex items-center justify-center mr-1 text-slate-400">
          {isDir ? (
            <Icon icon={isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'} className="text-[14px]" />
          ) : (
            <Icon icon="lucide:file" className="text-[13px] opacity-70" />
          )}
        </span>
        <span className="truncate flex-1" title={node.name}>{node.name}</span>
        
        {/* Diff Stats */}
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0 text-[11px]">
          {node.linesAdded > 0 && <span className="text-emerald-600">+{node.linesAdded}</span>}
          {node.linesRemoved > 0 && <span className="text-rose-600">-{node.linesRemoved}</span>}
        </div>
      </div>
      
      {isDir && isExpanded && (
        <div>
          {node.children.map(child => (
            <TreeNode 
              key={child.path} 
              node={child} 
              level={level + 1} 
              activeFile={activeFile} 
              onSelectFile={onSelectFile}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Return all ancestor directory path segments for a given file path */
function getAncestorPaths(filePath) {
  if (!filePath) return [];
  const parts = filePath.split('/');
  const ancestors = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

export default function FileTree({ parsedFiles, activeFile, onSelectFile }) {
  const tree = useMemo(() => buildFileTree(parsedFiles), [parsedFiles]);

  // Default expanded state: expand root level dirs AND ancestors of the active file
  const [expandedPaths, setExpandedPaths] = useState(() => {
    const set = new Set();
    if (tree.children) {
      tree.children.forEach(c => {
        if (c.type === 'dir') set.add(c.path);
      });
    }
    getAncestorPaths(activeFile).forEach(p => set.add(p));
    return set;
  });

  // When the active file changes (e.g. on scroll or external selection), ensure its parents are expanded
  useEffect(() => {
    if (!activeFile) return;
    setExpandedPaths(prev => {
      const next = new Set(prev);
      getAncestorPaths(activeFile).forEach(p => next.add(p));
      return next;
    });
  }, [activeFile]);

  const toggleExpand = (path) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto py-2">
      <div className="px-4 mb-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider flex justify-between">
        <span>Files Changed</span>
        <span>{parsedFiles.length}</span>
      </div>
      <div className="px-2">
        {tree.children && tree.children.map(child => (
          <TreeNode 
            key={child.path} 
            node={child} 
            level={0} 
            activeFile={activeFile} 
            onSelectFile={onSelectFile}
            expandedPaths={expandedPaths}
            toggleExpand={toggleExpand}
          />
        ))}
      </div>
    </div>
  );
}
