// ==========================================
// STATE MANAGEMENT & DATA MODELS
// ==========================================

const DEVELOPER_LAST_EDIT = "2026-06-16 17:00";

const PALETTE = [
  { name: 'Rose', class: 'proj-color-1', value: 'var(--proj-color-1)' },
  { name: 'Orange', class: 'proj-color-2', value: 'var(--proj-color-2)' },
  { name: 'Amber', class: 'proj-color-3', value: 'var(--proj-color-3)' },
  { name: 'Green', class: 'proj-color-4', value: 'var(--proj-color-4)' },
  { name: 'Teal', class: 'proj-color-5', value: 'var(--proj-color-5)' },
  { name: 'Blue', class: 'proj-color-6', value: 'var(--proj-color-6)' },
  { name: 'Purple', class: 'proj-color-7', value: 'var(--proj-color-7)' },
  { name: 'Fuchsia', class: 'proj-color-8', value: 'var(--proj-color-8)' },
  { name: 'Slate', class: 'proj-color-9', value: 'var(--proj-color-9)' }
];

let state = {
  projects: [],
  tasks: [],
  deadlines: [],
  ui: {
    theme: 'dark',
    zoomMonths: 12,
    viewportStartDate: '', // YYYY-MM-DD
    filterProjects: [],    // IDs of selected projects to show. Empty = all
    filterAssignees: [],   // Names of assignees to show. Empty = all
    hideListPanel: false,
    hideSidebar: false
  }
};

let dragContext = null;
let autoScrollInterval = null;
let autoScrollDir = 0;

function startAutoScroll(dir, initialMoveEvent) {
  if (autoScrollDir === dir) {
    return; // Already scrolling in this direction
  }
  
  stopAutoScroll();
  autoScrollDir = dir;
  
  autoScrollInterval = setInterval(() => {
    if (!dragContext) {
      stopAutoScroll();
      return;
    }
    
    const { viewportStartDate, zoomMonths } = state.ui;
    const timelineStart = parseLocalDate(viewportStartDate);
    const viewportWidth = document.getElementById('chartViewport').clientWidth || 1000;
    const timelineEnd = new Date(timelineStart.getTime());
    timelineEnd.setMonth(timelineEnd.getMonth() + zoomMonths);
    const totalDurationMs = timelineEnd.getTime() - timelineStart.getTime();

    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weekWidth = (msPerWeek / totalDurationMs) * viewportWidth;
    const monthWidth = viewportWidth / zoomMonths;

    let unit = 'trimester';
    if (weekWidth >= 30) {
      unit = 'week';
    } else if (monthWidth >= 75) {
      unit = 'month';
    }

    const newTimelineStart = new Date(timelineStart.getTime());
    if (unit === 'week') {
      newTimelineStart.setDate(newTimelineStart.getDate() + dir * 7);
    } else if (unit === 'month') {
      newTimelineStart.setMonth(newTimelineStart.getMonth() + dir);
    } else { // trimester
      newTimelineStart.setMonth(newTimelineStart.getMonth() + dir * 3);
    }

    const { minVal, maxVal } = getTimelineDataBounds();
    const scrollMin = minVal - 24;
    const scrollMax = maxVal + 24;
    const newVal = newTimelineStart.getFullYear() * 12 + newTimelineStart.getMonth();
    
    if (newVal >= scrollMin && newVal <= scrollMax) {
      state.ui.viewportStartDate = formatDateToString(newTimelineStart);
      saveState();
      updateTimelineStartSlider();
      
      // Re-trigger drag date updates based on the new timeline position
      const currentSvgRect = document.getElementById('ganttSvg').getBoundingClientRect();
      const currentMoveEvent = dragContext.lastMoveEvent || initialMoveEvent;
      const relativeX = currentMoveEvent.clientX - currentSvgRect.left;
      
      // Update task dates and dependencies
      const targetTask = state.tasks.find(t => t.id === dragContext.taskId);
      if (targetTask) {
        const newTimelineEnd = new Date(newTimelineStart.getTime());
        newTimelineEnd.setMonth(newTimelineEnd.getMonth() + zoomMonths);
        const newTotalDurationMs = newTimelineEnd.getTime() - newTimelineStart.getTime();
        
        if (dragContext.dragMode === 'move') {
          const targetX = relativeX - dragContext.mouseOffsetFromTaskStart;
          const targetDate = new Date(newTimelineStart.getTime() + (targetX / viewportWidth) * newTotalDurationMs);
          let newStart = snapToNearestDay(targetDate);
          const durationWeeks = targetTask.durationWeeks || 4;
          let newEnd = new Date(newStart.getTime() + durationWeeks * 7 * 86400000);
          
          targetTask.startDate = formatDateToString(newStart);
          targetTask.endDate = formatDateToString(newEnd);
          targetTask.startType = 'date';
          targetTask.startAfterTaskId = null;
          
        } else if (dragContext.dragMode === 'resize-start') {
          const targetX = relativeX - dragContext.mouseOffsetFromTaskStart;
          const targetDate = new Date(newTimelineStart.getTime() + (targetX / viewportWidth) * newTotalDurationMs);
          let newStart = snapToNearestDay(targetDate);
          const endD = parseLocalDate(dragContext.startEndDateStr);
          
          if (newStart < endD) {
            targetTask.startDate = formatDateToString(newStart);
            targetTask.durationWeeks = Math.max(1, Math.round((endD - newStart) / (7 * 86400000)));
            const newEnd = new Date(newStart.getTime() + targetTask.durationWeeks * 7 * 86400000);
            targetTask.endDate = formatDateToString(newEnd);
            targetTask.startType = 'date';
            targetTask.startAfterTaskId = null;
          }
          
        } else if (dragContext.dragMode === 'resize-end') {
          const targetX = relativeX + dragContext.mouseOffsetFromTaskEnd;
          const targetDate = new Date(newTimelineStart.getTime() + (targetX / viewportWidth) * newTotalDurationMs);
          let newEnd = snapToNearestDay(targetDate);
          const startD = parseLocalDate(dragContext.startStartDateStr);
          
          if (newEnd > startD) {
            targetTask.durationWeeks = Math.max(1, Math.round((newEnd - startD) / (7 * 86400000)));
            const finalEnd = new Date(startD.getTime() + targetTask.durationWeeks * 7 * 86400000);
            targetTask.endDate = formatDateToString(finalEnd);
          }
        }
        
        updateTaskDependencies(targetTask.id);
      }
      
      renderGanttChart();
    }
  }, 250); // scroll every 250ms (0.25 second)
}

function stopAutoScroll() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  autoScrollDir = 0;
}

// ==========================================
// UNDO / REDO HISTORY
// ==========================================

const MAX_UNDO_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let prevDataSnapshot = null; // snapshot of data state before last modification


// ==========================================
// STORAGE & DEFAULT PLACEHOLDERS
// ==========================================

let hasUnexportedChanges = false;

function loadState() {
  loadPlaceholderData();
  prevDataSnapshot = JSON.stringify({
    projects: state.projects,
    tasks: state.tasks,
    deadlines: state.deadlines
  });
}

function saveState(isDataModification = false) {
  if (isDataModification) {
    // Push the pre-modification snapshot onto the undo stack
    if (prevDataSnapshot !== null) {
      undoStack.push(prevDataSnapshot);
      if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
      redoStack = []; // new action clears redo
    }
    hasUnexportedChanges = true;
  }
  renderLastEdit();
  if (isDataModification) {
    // Update snapshot to current (post-modification) state
    prevDataSnapshot = JSON.stringify({
      projects: state.projects,
      tasks: state.tasks,
      deadlines: state.deadlines
    });
    updateUndoRedoButtons();
  }
}

function renderLastEdit() {
  const el = document.getElementById('lastEditTime');
  if (el) {
    el.textContent = DEVELOPER_LAST_EDIT;
  }
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function undo() {
  if (undoStack.length === 0) return;
  const current = JSON.stringify({ projects: state.projects, tasks: state.tasks, deadlines: state.deadlines });
  redoStack.push(current);
  const prev = JSON.parse(undoStack.pop());
  state.projects = prev.projects;
  state.tasks = prev.tasks;
  state.deadlines = prev.deadlines;
  prevDataSnapshot = JSON.stringify(prev);
  hasUnexportedChanges = true;
  renderLastEdit();
  updateUndoRedoButtons();
  syncDropdowns();
  populateSidebarFilters();
  renderGanttChart();
  renderDataTable();
}

function redo() {
  if (redoStack.length === 0) return;
  const current = JSON.stringify({ projects: state.projects, tasks: state.tasks, deadlines: state.deadlines });
  undoStack.push(current);
  const next = JSON.parse(redoStack.pop());
  state.projects = next.projects;
  state.tasks = next.tasks;
  state.deadlines = next.deadlines;
  prevDataSnapshot = JSON.stringify(next);
  hasUnexportedChanges = true;
  renderLastEdit();
  updateUndoRedoButtons();
  syncDropdowns();
  populateSidebarFilters();
  renderGanttChart();
  renderDataTable();
}

function loadPlaceholderData() {
  const currentYear = new Date().getFullYear();
  
  state.projects = [
    {
      id: 'proj-sleep',
      name: '[Example] Longitudinal Sleep Study',
      colorIndex: 5, // Blue
      startMonth: `${currentYear}-06`,
      endMonth: `${currentYear + 2}-12`
    },
    {
      id: 'proj-trial',
      name: '[Example] Clinical Trials Cohort A',
      colorIndex: 0, // Rose
      startMonth: `${currentYear}-08`,
      endMonth: `${currentYear + 1}-10`
    }
  ];

  state.tasks = [
    {
      id: 'task-lit',
      projectId: 'proj-sleep',
      name: 'Literature Review & Protocol Draft [Example]',
      startDate: `${currentYear}-06-01`,
      startAfterTaskId: null,
      startType: 'date',
      endType: 'duration',
      durationWeeks: 12,
      endDate: `${currentYear}-08-24`,
      assignee: 'Dr. Sarah Jenkins'
    },
    {
      id: 'task-irb',
      projectId: 'proj-sleep',
      name: 'IRB & Ethics Approval Submission [Example]',
      startDate: `${currentYear}-08-24`, // Starts after lit review ends
      startAfterTaskId: 'task-lit',
      startType: 'dependency',
      endType: 'duration',
      durationWeeks: 8,
      endDate: `${currentYear}-10-19`,
      assignee: 'Dr. Sarah Jenkins'
    },
    {
      id: 'task-screen',
      projectId: 'proj-sleep',
      name: 'Cohort Recruitment & Screening [Example]',
      startDate: `${currentYear}-10-01`,
      startAfterTaskId: null,
      startType: 'date',
      endType: 'duration',
      durationWeeks: 24,
      endDate: `${currentYear + 1}-03-18`,
      assignee: 'Marcus Vance'
    },
    {
      id: 'task-site',
      projectId: 'proj-trial',
      name: 'Site Setup & Equipment Calibration [Example]',
      startDate: `${currentYear}-08-01`,
      startAfterTaskId: null,
      startType: 'date',
      endType: 'duration',
      durationWeeks: 6,
      endDate: `${currentYear}-09-12`,
      assignee: 'Marcus Vance'
    },
    {
      id: 'task-dose',
      projectId: 'proj-trial',
      name: 'Cohort A Dose Testing Phase [Example]',
      startDate: `${currentYear}-09-12`,
      startAfterTaskId: 'task-site',
      startType: 'dependency',
      endType: 'duration',
      durationWeeks: 16,
      endDate: `${currentYear + 1}-01-02`,
      assignee: 'Dr. Kenji Sato'
    }
  ];

  // Let's create repeated assessments for the Sleep Study
  // In year currentYear + 1: Week 5
  // Monday of Week 5 in currentYear + 1
  const week5Y2 = getMondayOfISOWeek(currentYear + 1, 5);
  state.tasks.push({
    id: 'task-assess-y2',
    projectId: 'proj-sleep',
    name: 'Annual Cohort Assessment (Year 2) [Example]',
    startDate: formatDateToString(week5Y2),
    startAfterTaskId: null,
    startType: 'date',
    endType: 'duration',
    durationWeeks: 6,
    endDate: formatDateToString(new Date(week5Y2.getTime() + 6 * 7 * 86400000)),
    assignee: 'Dr. Sarah Jenkins'
  });

  // In year currentYear + 2: Week 5
  const week5Y3 = getMondayOfISOWeek(currentYear + 2, 5);
  state.tasks.push({
    id: 'task-assess-y3',
    projectId: 'proj-sleep',
    name: 'Annual Cohort Assessment (Year 3) [Example]',
    startDate: formatDateToString(week5Y3),
    startAfterTaskId: null,
    startType: 'date',
    endType: 'duration',
    durationWeeks: 6,
    endDate: formatDateToString(new Date(week5Y3.getTime() + 6 * 7 * 86400000)),
    assignee: 'Dr. Sarah Jenkins'
  });

  state.deadlines = [
    {
      id: 'dead-irb-meet',
      projectId: 'proj-sleep',
      name: 'IRB Review Meeting [Example]',
      date: `${currentYear}-10-15`
    },
    {
      id: 'dead-midterm',
      projectId: 'proj-trial',
      name: 'Midterm Safety Review [Example]',
      date: `${currentYear}-11-20`
    }
  ];

  state.ui.viewportStartDate = `${currentYear}-06-01`;
  state.ui.zoomMonths = 12;
  state.ui.filterProjects = ['none', 'proj-sleep', 'proj-trial'];
  state.ui.filterAssignees = ['Dr. Sarah Jenkins', 'Marcus Vance', 'Dr. Kenji Sato', 'Unassigned'];
  state.ui.hideListPanel = false;
  state.ui.hideSidebar = false;
  
  saveState(true);
}

// ==========================================
// DATE & WEEK UTILITIES (ISO Compliant)
// ==========================================

// Parse YYYY-MM-DD safely into local timezone midnight
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Parse YYYY-MM safely
function parseLocalMonth(monthStr) {
  if (!monthStr) return { year: new Date().getFullYear(), month: new Date().getMonth() };
  const [year, month] = monthStr.split('-').map(Number);
  return { year, month: month - 1 };
}

function formatDateToString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTaskIterationYears(task) {
  if (!task.isIterated) {
    return [parseLocalDate(task.startDate).getFullYear()];
  }
  
  if (task.projectId && task.projectId !== 'none') {
    const project = state.projects.find(p => p.id === task.projectId);
    if (project && project.startMonth && project.endMonth) {
      const startYear = parseLocalMonth(project.startMonth).year;
      const endYear = parseLocalMonth(project.endMonth).year;
      const years = [];
      for (let y = startYear; y <= endYear; y++) {
        years.push(y);
      }
      return years;
    }
  }
  
  // General Tasks (none)
  if (state.projects.length > 0) {
    let minYear = Infinity;
    let maxYear = -Infinity;
    state.projects.forEach(p => {
      if (p.startMonth && p.endMonth) {
        const sy = parseLocalMonth(p.startMonth).year;
        const ey = parseLocalMonth(p.endMonth).year;
        if (sy < minYear) minYear = sy;
        if (ey > maxYear) maxYear = ey;
      }
    });
    if (minYear !== Infinity) {
      const years = [];
      for (let y = minYear; y <= maxYear; y++) {
        years.push(y);
      }
      return years;
    }
  }
  
  const cy = new Date().getFullYear();
  return [cy, cy + 1, cy + 2];
}

function getTaskOccurrenceDates(task, year) {
  const baseStart = parseLocalDate(task.startDate);
  const baseYear = baseStart.getFullYear();
  if (year === baseYear) {
    return {
      startDate: task.startDate,
      endDate: task.endDate
    };
  }
  
  const baseWeek = getISOWeekNumber(baseStart);
  const baseDayOfWeek = baseStart.getDay() || 7;
  const targetMonday = getMondayOfISOWeek(year, baseWeek);
  const targetStartDate = new Date(targetMonday.getTime() + (baseDayOfWeek - 1) * 86400000);
  const targetEndDate = new Date(targetStartDate.getTime() + task.durationWeeks * 7 * 86400000);
  
  return {
    startDate: formatDateToString(targetStartDate),
    endDate: formatDateToString(targetEndDate)
  };
}

// Get Monday of the week containing the date
function getMonday(d) {
  const date = new Date(d.getTime());
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

// Get the ISO Week number of a Date
function getISOWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// Returns the Monday Date of Week W in Year Y
function getMondayOfISOWeek(year, week) {
  // Jan 4 is always in Week 1
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay();
  const week1Monday = new Date(jan4.getTime() - (day === 0 ? 6 : day - 1) * 86400000);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
}

// Helper: snap to nearest day (prevents timezone/rounding drift during dragging)
function snapToNearestDay(date) {
  const rounded = new Date(date.getTime());
  rounded.setHours(0, 0, 0, 0);
  const diffHours = (date.getTime() - rounded.getTime()) / (1000 * 60 * 60);
  if (diffHours >= 12) {
    rounded.setDate(rounded.getDate() + 1);
  } else if (diffHours <= -12) {
    rounded.setDate(rounded.getDate() - 1);
  }
  return rounded;
}

// Helper: snap to nearest week (Monday of the week)
function snapToNearestWeek(date) {
  const monday = getMonday(date);
  const nextMonday = new Date(monday.getTime() + 7 * 86400000);
  const diffCurrent = Math.abs(date.getTime() - monday.getTime());
  const diffNext = Math.abs(date.getTime() - nextMonday.getTime());
  return diffCurrent < diffNext ? monday : nextMonday;
}

// Helper: Get all task IDs in the connected component of a task's dependencies (undirected)
function getLinkedTaskChain(taskId) {
  const chain = new Set();
  const queue = [taskId];
  chain.add(taskId);
  
  while (queue.length > 0) {
    const currentId = queue.shift();
    
    // 1. Predecessors of current
    const task = state.tasks.find(t => t.id === currentId);
    if (task && task.startType === 'dependency' && task.startAfterTaskId) {
      const predId = task.startAfterTaskId;
      if (!chain.has(predId)) {
        chain.add(predId);
        queue.push(predId);
      }
    }
    
    // 2. Successors of current
    state.tasks.forEach(t => {
      if (t.startType === 'dependency' && t.startAfterTaskId === currentId) {
        if (!chain.has(t.id)) {
          chain.add(t.id);
          queue.push(t.id);
        }
      }
    });
  }
  
  return Array.from(chain);
}

// Helper: Sort tasks within a project such that connected task chains are placed on adjacent rows
function sortTasksWithLinkedAdjacent(tasks) {
  const visited = new Set();
  const components = [];
  
  tasks.forEach(t => {
    if (!visited.has(t.id)) {
      const chain = getLinkedTaskChain(t.id);
      // Filter the chain to only include tasks present in the current array
      const projChain = chain.filter(id => tasks.some(x => x.id === id));
      projChain.forEach(id => visited.add(id));
      components.push(projChain);
    }
  });
  
  // Sort tasks within each component chronologically
  components.forEach(comp => {
    comp.sort((idA, idB) => {
      const a = tasks.find(x => x.id === idA);
      const b = tasks.find(x => x.id === idB);
      if (!a || !b) return 0;
      const startDiff = a.startDate.localeCompare(b.startDate);
      if (startDiff !== 0) return startDiff;
      return a.endDate.localeCompare(b.endDate);
    });
  });
  
  // Sort components relative to each other based on the earliest task in each component
  components.sort((compA, compB) => {
    const a = tasks.find(x => x.id === compA[0]);
    const b = tasks.find(x => x.id === compB[0]);
    if (!a || !b) return 0;
    const startDiff = a.startDate.localeCompare(b.startDate);
    if (startDiff !== 0) return startDiff;
    return a.endDate.localeCompare(b.endDate);
  });
  
  // Flatten back to array of tasks
  const result = [];
  components.forEach(comp => {
    comp.forEach(id => {
      const t = tasks.find(x => x.id === id);
      if (t) result.push(t);
    });
  });
  
  return result;
}

function resolveTaskSortOrders(projectTasks) {
  const hasCustom = projectTasks.some(t => t.sortOrder !== undefined && t.sortOrder !== null);
  if (!hasCustom) return;

  const sorted = projectTasks
    .filter(t => t.sortOrder !== undefined && t.sortOrder !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const unsorted = projectTasks.filter(t => t.sortOrder === undefined || t.sortOrder === null);
  if (unsorted.length === 0) return;

  const chronological = sortTasksWithLinkedAdjacent(projectTasks);
  const unsortedInChronologicalOrder = chronological.filter(t => t.sortOrder === undefined || t.sortOrder === null);

  unsortedInChronologicalOrder.forEach(task => {
    const idx = chronological.indexOf(task);
    
    let prevSorted = null;
    let nextSorted = null;

    for (let i = idx - 1; i >= 0; i--) {
      const t = chronological[i];
      if (t.sortOrder !== undefined && t.sortOrder !== null) {
        prevSorted = t;
        break;
      }
    }

    for (let i = idx + 1; i < chronological.length; i++) {
      const t = chronological[i];
      if (t.sortOrder !== undefined && t.sortOrder !== null) {
        nextSorted = t;
        break;
      }
    }

    if (prevSorted && nextSorted) {
      task.sortOrder = (prevSorted.sortOrder + nextSorted.sortOrder) / 2;
    } else if (prevSorted) {
      task.sortOrder = prevSorted.sortOrder + 10;
    } else if (nextSorted) {
      task.sortOrder = nextSorted.sortOrder - 10;
    } else {
      task.sortOrder = 0;
    }
  });
}

// ==========================================
// CASCADING SHIFTS & RECURRENCE MATH
// ==========================================

function updateTaskDependencies(changedTaskId) {
  const parentTask = state.tasks.find(t => t.id === changedTaskId);
  if (!parentTask) return;

  const parentEndDate = parseLocalDate(parentTask.endDate);
  
  // Find all children tasks that start after this task
  const children = state.tasks.filter(t => t.startAfterTaskId === changedTaskId);
  for (const child of children) {
    // If parent is iterated, child must be iterated also!
    if (parentTask.isIterated && !child.isIterated) {
      child.isIterated = true;
    }
    
    const prevStartStr = child.startDate;
    child.startDate = formatDateToString(parentEndDate);
    
    // Shift end date to preserve duration
    if (child.endType === 'duration') {
      const childStart = parentEndDate;
      const childEnd = new Date(childStart.getTime() + child.durationWeeks * 7 * 86400000);
      child.endDate = formatDateToString(childEnd);
    } else {
      // Hard end date mode: preserve duration and adjust end date accordingly, OR keep end date and adjust duration?
      // "Automatically update the dependent task's start date... preserving the dependent task's duration (cascading shifts downstream)"
      // So even if it had a hard end date, we shift its end date to preserve its duration:
      const prevStart = parseLocalDate(prevStartStr);
      const prevEnd = parseLocalDate(child.endDate);
      const prevDurationWeeks = Math.ceil((prevEnd - prevStart) / (7 * 86400000)) || 1;
      const childEnd = new Date(parentEndDate.getTime() + prevDurationWeeks * 7 * 86400000);
      child.endDate = formatDateToString(childEnd);
      child.durationWeeks = prevDurationWeeks;
    }
    
    // Cascading updates
    updateTaskDependencies(child.id);
  }
}

// Create copies of a task across other project years for the same ISO week
function createRecurrentCopies(baseTask, project) {
  if (!project) return;
  
  const baseStart = parseLocalDate(baseTask.startDate);
  const baseYear = baseStart.getFullYear();
  const baseWeek = getISOWeekNumber(baseStart);
  const baseDayOfWeek = baseStart.getDay() || 7; // 1 (Mon) - 7 (Sun)
  
  const projStartMonth = parseLocalMonth(project.startMonth);
  const projEndMonth = parseLocalMonth(project.endMonth);
  
  const startYear = projStartMonth.year;
  const endYear = projEndMonth.year;
  
  for (let year = startYear; year <= endYear; year++) {
    if (year === baseYear) continue; // Skip the original task's year
    
    // Find the matching Monday for this week in the target year
    const targetMonday = getMondayOfISOWeek(year, baseWeek);
    const targetStartDate = new Date(targetMonday.getTime() + (baseDayOfWeek - 1) * 86400000);
    
    // Verify target date is within project limits
    const projStartLimit = new Date(projStartMonth.year, projStartMonth.month, 1);
    const projEndLimit = new Date(projEndMonth.year, projEndMonth.month + 1, 0, 23, 59, 59);
    
    if (targetStartDate < projStartLimit || targetStartDate > projEndLimit) {
      continue; // Skip if it falls outside project dates
    }
    
    const targetEndDate = new Date(targetStartDate.getTime() + baseTask.durationWeeks * 7 * 86400000);
    
    const copyTask = {
      id: 'task-' + Math.random().toString(36).substr(2, 9),
      projectId: baseTask.projectId,
      name: `${baseTask.name} (${year})`,
      startDate: formatDateToString(targetStartDate),
      startAfterTaskId: null,
      startType: 'date',
      endType: baseTask.endType,
      durationWeeks: baseTask.durationWeeks,
      endDate: formatDateToString(targetEndDate),
      assignee: baseTask.assignee
    };
    
    state.tasks.push(copyTask);
  }
}

function isTaskVisibleInTimeline(task, timelineStart, timelineEnd) {
  // If the task is currently being dragged, always keep it visible
  if (dragContext && dragContext.taskId === task.id) {
    return true;
  }
  const years = getTaskIterationYears(task);
  return years.some(y => {
    const occ = getTaskOccurrenceDates(task, y);
    const start = parseLocalDate(occ.startDate);
    const end = parseLocalDate(occ.endDate);
    return start <= timelineEnd && end >= timelineStart;
  });
}

function isDeadlineVisible(deadline, timelineStart, timelineEnd) {
  const dDate = parseLocalDate(deadline.date);
  return dDate >= timelineStart && dDate <= timelineEnd;
}



// ==========================================
// RENDERING THE SVG GANTT CHART
// ==========================================

function renderGanttChart(overrideWidth) {
  const svg = document.getElementById('ganttSvg');
  const headerSvg = document.getElementById('ganttHeaderSvg');
  if (!svg) return 0;
  
  // Clear SVG first
  svg.innerHTML = '';
  if (headerSvg) {
    headerSvg.innerHTML = '';
  }
  
  // 1. Calculate Viewport Start and Zoom width
  const { viewportStartDate, zoomMonths } = state.ui;
  const timelineStart = parseLocalDate(viewportStartDate);
  const timelineEnd = new Date(timelineStart.getTime());
  timelineEnd.setMonth(timelineEnd.getMonth() + zoomMonths);
  const totalDurationMs = timelineEnd.getTime() - timelineStart.getTime();

  // Helper: Date to X Coordinate
  function dateToX(dateStr) {
    const d = parseLocalDate(dateStr);
    const elapsed = d.getTime() - timelineStart.getTime();
    return (elapsed / totalDurationMs) * viewportWidth;
  }

  // Pack deadlines into non-overlapping lanes (sub-rows)
  function packDeadlines(deadlines, diaSize, dateToX) {
    if (!deadlines || deadlines.length === 0) return { lanes: [], height: 0, laneHeight: 0 };
    
    // Sort deadlines by date/X coordinate ascending
    const sortedDeads = [...deadlines].map(d => {
      const deadX = dateToX(d.date);
      const textWidth = d.name.length * 7.2;
      return {
        d,
        deadX,
        left: deadX - diaSize / 2 - 8,
        right: deadX + diaSize / 2 + 5 + textWidth + 8
      };
    }).sort((a, b) => a.deadX - b.deadX);

    const lanes = [];
    sortedDeads.forEach(item => {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        const hasOverlap = lane.some(placedItem => {
          return item.left < placedItem.right && item.right > placedItem.left;
        });
        if (!hasOverlap) {
          lane.push(item);
          item.laneIndex = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        lanes.push([item]);
        item.laneIndex = lanes.length - 1;
      }
    });

    const laneHeight = 22;
    const height = lanes.length <= 1 ? 28 : lanes.length * laneHeight + 6;
    return { lanes, height, laneHeight };
  }


  
  const viewport = document.getElementById('chartViewport');
  const viewportWidth = overrideWidth !== undefined ? overrideWidth : (viewport ? (viewport.clientWidth || 1000) : 1000);

  // Determine dynamic column resolution based on viewport width and zoom
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekWidth = (msPerWeek / totalDurationMs) * viewportWidth;
  const monthWidth = viewportWidth / zoomMonths;
  const trimesterWidth = monthWidth * 3;
  const semesterWidth = monthWidth * 6;
  const yearWidth = monthWidth * 12;

  let resolution = 'week';
  if (weekWidth < 30) resolution = 'month';
  if (monthWidth < 75) resolution = 'trimester';
  if (trimesterWidth < 75) resolution = 'semester';
  if (semesterWidth < 75) resolution = 'year';
  
  // Build columns configurations
  const columns = [];
  let curr = new Date(timelineStart.getTime());
  
  if (resolution === 'week') {
    let weekComm = getMonday(timelineStart);
    while (weekComm < timelineEnd) {
      const nextWeekComm = new Date(weekComm.getTime() + 7 * 86400000);
      const colX = dateToX(formatDateToString(weekComm));
      const nextColX = dateToX(formatDateToString(nextWeekComm));
      columns.push({
        x: colX,
        width: nextColX - colX,
        startDate: new Date(weekComm.getTime()),
        endDate: nextWeekComm,
        minorLabel: weekWidth < 45 ? `W${getISOWeekNumber(weekComm)}` : `${String(weekComm.getMonth()+1).padStart(2, '0')}/${String(weekComm.getDate()).padStart(2, '0')}`,
        majorLabel: weekComm.toLocaleString('en-US', { month: 'long', year: 'numeric' })
      });
      weekComm = nextWeekComm;
    }
  } else if (resolution === 'month') {
    while (curr < timelineEnd) {
      const nextCurr = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
      const colX = dateToX(formatDateToString(curr));
      const nextColX = dateToX(formatDateToString(nextCurr));
      columns.push({
        x: colX,
        width: nextColX - colX,
        startDate: new Date(curr.getTime()),
        endDate: nextCurr,
        minorLabel: curr.toLocaleString('en-US', { month: 'long' }),
        majorLabel: curr.getFullYear().toString()
      });
      curr = nextCurr;
    }
  } else if (resolution === 'trimester') {
    const startMonth = Math.floor(curr.getMonth() / 3) * 3;
    curr = new Date(curr.getFullYear(), startMonth, 1);
    while (curr < timelineEnd) {
      const nextCurr = new Date(curr.getFullYear(), curr.getMonth() + 3, 1);
      const colX = dateToX(formatDateToString(curr));
      const nextColX = dateToX(formatDateToString(nextCurr));
      const triIndex = Math.floor(curr.getMonth() / 3) + 1;
      columns.push({
        x: colX,
        width: nextColX - colX,
        startDate: new Date(curr.getTime()),
        endDate: nextCurr,
        minorLabel: `Trim. ${triIndex}`,
        majorLabel: curr.getFullYear().toString()
      });
      curr = nextCurr;
    }
  } else if (resolution === 'semester') {
    const startMonth = Math.floor(curr.getMonth() / 6) * 6;
    curr = new Date(curr.getFullYear(), startMonth, 1);
    while (curr < timelineEnd) {
      const nextCurr = new Date(curr.getFullYear(), curr.getMonth() + 6, 1);
      const colX = dateToX(formatDateToString(curr));
      const nextColX = dateToX(formatDateToString(nextCurr));
      const semIndex = Math.floor(curr.getMonth() / 6) + 1;
      columns.push({
        x: colX,
        width: nextColX - colX,
        startDate: new Date(curr.getTime()),
        endDate: nextCurr,
        minorLabel: `Sem. ${semIndex}`,
        majorLabel: curr.getFullYear().toString()
      });
      curr = nextCurr;
    }
  } else {
    curr = new Date(curr.getFullYear(), 0, 1);
    while (curr < timelineEnd) {
      const nextCurr = new Date(curr.getFullYear() + 1, 0, 1);
      const colX = dateToX(formatDateToString(curr));
      const nextColX = dateToX(formatDateToString(nextCurr));
      columns.push({
        x: colX,
        width: nextColX - colX,
        startDate: new Date(curr.getTime()),
        endDate: nextCurr,
        minorLabel: curr.getFullYear().toString(),
        majorLabel: 'Timeline'
      });
      curr = nextCurr;
    }
  }

  // Filter projects and tasks (ticked projects/assignees only)
  const filteredProjects = state.projects.filter(p => 
    state.ui.filterProjects.includes(p.id)
  );
  
  const filteredTasks = state.tasks.filter(t => {
    const pId = t.projectId || 'none';
    if (pId === 'none') {
      if (!state.ui.filterProjects.includes('none')) return false;
    } else {
      if (!state.ui.filterProjects.includes(pId)) return false;
    }
    
    const taskAssignees = t.assignee ? t.assignee.split(',').map(a => a.trim()).filter(Boolean) : [];
    if (taskAssignees.length === 0) {
      taskAssignees.push('Unassigned');
    }
    const hasMatch = taskAssignees.some(a => state.ui.filterAssignees.includes(a));
    if (!hasMatch) return false;
    
    return true;
  });

  const filteredDeadlines = state.deadlines.filter(d => {
    const pId = d.projectId || 'none';
    return state.ui.filterProjects.includes(pId);
  });

  const tasksByProject = {};
  filteredTasks.forEach(t => {
    const pId = t.projectId || 'none';
    if (!tasksByProject[pId]) tasksByProject[pId] = [];
    tasksByProject[pId].push(t);
  });
  
  // Sort tasks within each project: earliest start date first, then earliest end date first.
  // Exception to the rule: Linked tasks must remain on adjacent rows.
  // During drag operations, preserve the cached order from drag initiation to prevent tasks from jumping swimlanes.
  Object.keys(tasksByProject).forEach(pId => {
    if (dragContext && dragContext.preDragOrder && dragContext.preDragOrder[pId]) {
      const order = dragContext.preDragOrder[pId];
      tasksByProject[pId].sort((a, b) => {
        const idxA = order.indexOf(a.id);
        const idxB = order.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        
        return 0;
      });
    } else {
      resolveTaskSortOrders(tasksByProject[pId]);
      const hasCustom = tasksByProject[pId].some(t => t.sortOrder !== undefined && t.sortOrder !== null);
      if (hasCustom) {
        tasksByProject[pId].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      } else {
        tasksByProject[pId] = sortTasksWithLinkedAdjacent(tasksByProject[pId]);
      }
    }
  });
  
  const headerHeight = 50;
  const rowHeight = 35;
  const groupHeaderHeight = 40;
  const deadlineRowHeight = 28;
  const rowGap = 5;
  
  let currentY = headerHeight;
  const renderedRows = [];

  if (state.ui.filterProjects.includes('none')) {
    const generalTasks = tasksByProject['none'] || [];
    const generalDeadlines = filteredDeadlines.filter(d => (d.projectId || 'none') === 'none');

    currentY += 10;
    renderedRows.push({
      y: currentY,
      type: 'group-header',
      label: 'General Tasks',
      color: 'var(--text-tertiary)'
    });
    currentY += groupHeaderHeight;

    // Deadline row for General Tasks (if any)
    const visibleGeneralDeadlines = generalDeadlines.filter(d => isDeadlineVisible(d, timelineStart, timelineEnd));
    if (visibleGeneralDeadlines.length > 0) {
      const packing = packDeadlines(visibleGeneralDeadlines, 13, dateToX);
      renderedRows.push({
        y: currentY,
        type: 'deadline-row',
        projectId: 'none',
        deadlines: visibleGeneralDeadlines,
        color: 'var(--text-tertiary)',
        lanes: packing.lanes,
        laneHeight: packing.laneHeight,
        rowHeight: packing.height
      });
      currentY += packing.height;
    }
    
    generalTasks.forEach(t => {
      if (isTaskVisibleInTimeline(t, timelineStart, timelineEnd)) {
        renderedRows.push({
          y: currentY,
          type: 'task',
          data: t,
          color: 'var(--text-secondary)'
        });
        currentY += rowHeight;
      }
    });
  }

  filteredProjects.forEach(p => {
    const projTasks = tasksByProject[p.id] || [];
    const projDeadlines = filteredDeadlines.filter(d => d.projectId === p.id);

    currentY += 10;
    const pColor = PALETTE[p.colorIndex] || PALETTE[8];
    renderedRows.push({
      y: currentY,
      type: 'group-header',
      label: p.name,
      projectData: p,
      color: pColor.value
    });
    currentY += groupHeaderHeight;

    // Deadline row for this project (if any)
    const visibleProjDeadlines = projDeadlines.filter(d => isDeadlineVisible(d, timelineStart, timelineEnd));
    if (visibleProjDeadlines.length > 0) {
      const packing = packDeadlines(visibleProjDeadlines, 13, dateToX);
      renderedRows.push({
        y: currentY,
        type: 'deadline-row',
        projectId: p.id,
        deadlines: visibleProjDeadlines,
        color: pColor.value,
        lanes: packing.lanes,
        laneHeight: packing.laneHeight,
        rowHeight: packing.height
      });
      currentY += packing.height;
    }
    projTasks.forEach(t => {
      if (isTaskVisibleInTimeline(t, timelineStart, timelineEnd)) {
        renderedRows.push({
          y: currentY,
          type: 'task',
          data: t,
          color: pColor.value
        });
        currentY += rowHeight;
      }
    });
  });
  
  const totalHeight = currentY + 30;
  
  // Set dimensions on SVG element (use viewportWidth to make it fit)
  svg.setAttribute('width', viewportWidth);
  svg.setAttribute('height', totalHeight);
  if (headerSvg) {
    headerSvg.setAttribute('width', viewportWidth);
    headerSvg.setAttribute('height', headerHeight);
  }
  
  // 2. Draw alternating swimlane background rects
  let isEvenRow = false;
  renderedRows.forEach(row => {
    if (row.type === 'task') {
      const swimlane = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      swimlane.setAttribute('x', 0);
      swimlane.setAttribute('y', row.y);
      swimlane.setAttribute('width', viewportWidth);
      swimlane.setAttribute('height', rowHeight);
      
      let cls = 'svg-swimlane';
      if (isEvenRow) cls += ' even';
      
      // Highlight project drop zone if dragging
      if (dragContext && dragContext.dragMode === 'move') {
        const targetProjectId = row.data.projectId || 'none';
        if (dragContext.hoveredProjId === targetProjectId) {
          cls += ' highlighted-drop';
        }
      }
      
      swimlane.setAttribute('class', cls);
      svg.appendChild(swimlane);
      isEvenRow = !isEvenRow;
    }
  });

  // 3. Draw Grid & Weekend Shading
  if (resolution === 'week') {
    columns.forEach(col => {
      const dayWidth = col.width / 7;
      const weekendRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      weekendRect.setAttribute('x', col.x + 5 * dayWidth);
      weekendRect.setAttribute('y', headerHeight);
      weekendRect.setAttribute('width', 2 * dayWidth);
      weekendRect.setAttribute('height', totalHeight - headerHeight);
      weekendRect.setAttribute('class', 'svg-weekend-rect');
      svg.appendChild(weekendRect);
    });
  }
  
  // 3b. Highlight current time-unit (today's column)
  const today = new Date();
  const todayCol = columns.find(col => today >= col.startDate && today < col.endDate);
  if (todayCol) {
    const todayHighlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    todayHighlight.setAttribute('x', todayCol.x);
    todayHighlight.setAttribute('y', 0);
    todayHighlight.setAttribute('width', todayCol.width);
    todayHighlight.setAttribute('height', totalHeight);
    todayHighlight.setAttribute('class', 'svg-today-highlight');
    svg.appendChild(todayHighlight);
  }
  
  columns.forEach((col, idx) => {
    if (col.x < 0 || col.x > viewportWidth) return;
    
    const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    gridLine.setAttribute('x1', col.x);
    gridLine.setAttribute('y1', 0);
    gridLine.setAttribute('x2', col.x);
    gridLine.setAttribute('y2', totalHeight);
    
    let isMajor = false;
    if (resolution === 'week') {
      isMajor = col.startDate.getDate() <= 7 || idx === 0;
    } else if (resolution === 'month') {
      isMajor = col.startDate.getMonth() === 0 || idx === 0;
    } else if (resolution === 'trimester') {
      isMajor = col.startDate.getMonth() === 0 || idx === 0;
    } else if (resolution === 'semester') {
      isMajor = col.startDate.getMonth() === 0 || idx === 0;
    } else if (resolution === 'year') {
      isMajor = true;
    }
    
    gridLine.setAttribute('class', isMajor ? 'svg-grid-line-major' : 'svg-grid-line');
    svg.appendChild(gridLine);
  });
  
  const finalLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  finalLine.setAttribute('x1', viewportWidth);
  finalLine.setAttribute('y1', 0);
  finalLine.setAttribute('x2', viewportWidth);
  finalLine.setAttribute('y2', totalHeight);
  finalLine.setAttribute('class', 'svg-grid-line-major');
  svg.appendChild(finalLine);

  // Draw Horizontal swimlane divider lines
  renderedRows.forEach(row => {
    if (row.type === 'task') {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', row.y + rowHeight);
      line.setAttribute('x2', viewportWidth);
      line.setAttribute('y2', row.y + rowHeight);
      line.setAttribute('stroke', 'var(--border-color)');
      line.setAttribute('stroke-width', '0.5');
      svg.appendChild(line);
    } else if (row.type === 'deadline-row') {
      // Bottom border for deadline row
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', row.y + row.rowHeight);
      line.setAttribute('x2', viewportWidth);
      line.setAttribute('y2', row.y + row.rowHeight);
      line.setAttribute('stroke', 'var(--border-color)');
      line.setAttribute('stroke-width', '0.5');
      svg.appendChild(line);
    }
  });

  // 4. Draw Dependency Connections (Arrows)
  filteredTasks.forEach(task => {
    if (task.startType === 'dependency' && task.startAfterTaskId) {
      const parent = filteredTasks.find(t => t.id === task.startAfterTaskId);
      if (parent) {
        const parentRow = renderedRows.find(r => r.type === 'task' && r.data.id === parent.id);
        const childRow = renderedRows.find(r => r.type === 'task' && r.data.id === task.id);
        
        if (parentRow && childRow) {
          const parentYears = getTaskIterationYears(parent);
          const childYears = getTaskIterationYears(task);
          const commonYears = parentYears.filter(y => childYears.includes(y));
          
          commonYears.forEach(year => {
            const parentOcc = getTaskOccurrenceDates(parent, year);
            const childOcc = getTaskOccurrenceDates(task, year);
            
            const parentX2 = dateToX(parentOcc.endDate);
            const parentY = parentRow.y + (rowHeight / 2) - 3;
            
            const childX1 = dateToX(childOcc.startDate);
            const childY = childRow.y + (rowHeight / 2) - 3;
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            
            let dPath = '';
            if (childX1 >= parentX2) {
              const midX = parentX2 + (childX1 - parentX2) / 2;
              dPath = `M ${parentX2} ${parentY} L ${midX} ${parentY} L ${midX} ${childY} L ${childX1} ${childY}`;
            } else {
              const hookX = parentX2 + 10;
              const midY = parentY + (childY - parentY) / 2;
              dPath = `M ${parentX2} ${parentY} L ${hookX} ${parentY} L ${hookX} ${midY} L ${childX1 - 10} ${midY} L ${childX1 - 10} ${childY} L ${childX1} ${childY}`;
            }
            
            path.setAttribute('d', dPath);
            path.setAttribute('class', 'dependency-line');
            path.style.stroke = parentRow.color;
            
            path.addEventListener('mouseenter', (e) => {
              showTooltip(e, `<strong>Dependency Link</strong><br>Task: "${task.name}" starts after "${parent.name}" (${year})`);
            });
            path.addEventListener('mouseleave', hideTooltip);
            
            svg.appendChild(path);
            
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', `${childX1},${childY} ${childX1-5},${childY-3} ${childX1-5},${childY+3}`);
            arrow.setAttribute('class', 'dependency-arrow');
            arrow.style.fill = parentRow.color;
            arrow.style.stroke = parentRow.color;
            svg.appendChild(arrow);
          });
        }
      }
    }
  });

  // 5. Shared Drag and Drop handler for tasks (Bar and Text grab)
  // 5. Shared Drag and Drop handler for tasks (Bar and Text grab)
  function initiateDrag(e, task, dragMode, dragYear = null) {
    e.preventDefault();
    e.stopPropagation();
    
    // Snapshot the current order of task IDs for each project/general section to freeze row sorting during drag
    const preDragOrder = {};
    const filteredTasks = state.tasks.filter(t => {
      const pId = t.projectId || 'none';
      if (pId === 'none') {
        if (!state.ui.filterProjects.includes('none')) return false;
      } else {
        if (!state.ui.filterProjects.includes(pId)) return false;
      }
      const taskAssignees = t.assignee ? t.assignee.split(',').map(a => a.trim()).filter(Boolean) : [];
      if (taskAssignees.length === 0) {
        taskAssignees.push('Unassigned');
      }
      const hasMatch = taskAssignees.some(a => state.ui.filterAssignees.includes(a));
      if (!hasMatch) return false;
      return true;
    });
    
    const tempTasksByProject = {};
    filteredTasks.forEach(t => {
      const pId = t.projectId || 'none';
      if (!tempTasksByProject[pId]) tempTasksByProject[pId] = [];
      tempTasksByProject[pId].push(t);
    });
    
    Object.keys(tempTasksByProject).forEach(pId => {
      resolveTaskSortOrders(tempTasksByProject[pId]);
      const hasCustom = tempTasksByProject[pId].some(t => t.sortOrder !== undefined && t.sortOrder !== null);
      if (hasCustom) {
        tempTasksByProject[pId].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      } else {
        tempTasksByProject[pId] = sortTasksWithLinkedAdjacent(tempTasksByProject[pId]);
      }
      preDragOrder[pId] = tempTasksByProject[pId].map(t => t.id);
    });
    
    const svgRect = svg.getBoundingClientRect();
    const mouseRelativeX = e.clientX - svgRect.left;
    const mouseRelativeY = e.clientY - svgRect.top;

    const baseStart = parseLocalDate(task.startDate);
    const baseYear = baseStart.getFullYear();
    const effectiveYear = dragYear || baseYear;
    const occ = getTaskOccurrenceDates(task, effectiveYear);
    
    const startX = dateToX(occ.startDate);
    const startX2 = dateToX(occ.endDate);

    const row = renderedRows.find(r => r.type === 'task' && r.data.id === task.id);
    const originalRowY = row ? row.y : 0;

    dragContext = {
      taskId: task.id,
      dragMode: dragMode,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startStartDateStr: task.startDate,
      startEndDateStr: task.endDate,
      dragYear: effectiveYear,
      startOccurrenceStartDateStr: occ.startDate,
      startOccurrenceEndDateStr: occ.endDate,
      startProjectId: task.projectId || 'none',
      hoveredProjId: task.projectId || 'none',
      mouseRelativeX: mouseRelativeX,
      mouseRelativeY: mouseRelativeY,
      preDragOrder: preDragOrder,
      
      // Store initial mouse offsets relative to the task bar start, end, and top (in pixels)
      mouseOffsetFromTaskStart: mouseRelativeX - startX,
      mouseOffsetFromTaskEnd: startX2 - mouseRelativeX,
      mouseOffsetFromTaskTop: mouseRelativeY - (originalRowY + 4),
      lastMoveEvent: e
    };
    
    let cur = 'move';
    if (dragMode === 'resize-start') cur = 'w-resize';
    if (dragMode === 'resize-end') cur = 'e-resize';
    document.body.style.cursor = cur;
    
    svg.classList.add('drag-move-active');
    
    const handleDragMove = (moveEvent) => {
      if (!dragContext) return;
      
      dragContext.lastMoveEvent = moveEvent;
      
      const currentSvgRect = svg.getBoundingClientRect();
      const relativeX = moveEvent.clientX - currentSvgRect.left;
      const relativeY = moveEvent.clientY - currentSvgRect.top;
      
      dragContext.mouseRelativeX = relativeX;
      dragContext.mouseRelativeY = relativeY;
      
      // Auto-scroll check
      const viewportEl = document.getElementById('chartViewport');
      const leftIndicator = document.getElementById('leftScrollZone');
      const rightIndicator = document.getElementById('rightScrollZone');
      if (leftIndicator) leftIndicator.classList.remove('hovered');
      if (rightIndicator) rightIndicator.classList.remove('hovered');

      if (viewportEl) {
        const rect = viewportEl.getBoundingClientRect();
        const mouseX = moveEvent.clientX;
        
        // Define active scroll zones (e.g. 50px from the edges of the viewport)
        const zoneWidth = 50;
        const nearLeft = mouseX < rect.left + zoneWidth;
        const nearRight = mouseX > rect.right - zoneWidth;
        
        if (nearLeft) {
          if (leftIndicator) leftIndicator.classList.add('hovered');
          startAutoScroll(-1, moveEvent);
        } else if (nearRight) {
          if (rightIndicator) rightIndicator.classList.add('hovered');
          startAutoScroll(1, moveEvent);
        } else {
          stopAutoScroll();
        }
      }

      let hoveredProjId = dragContext.startProjectId;
      let closestRow = null;
      let minDiff = Infinity;
      
      renderedRows.forEach(row => {
        const rowCenter = row.y + (row.type === 'group-header' ? groupHeaderHeight : row.type === 'deadline-row' ? row.rowHeight : rowHeight) / 2;
        const diff = Math.abs(relativeY - rowCenter);
        if (diff < minDiff) {
          minDiff = diff;
          closestRow = row;
        }
      });
      
      if (closestRow) {
        if (closestRow.type === 'group-header') {
          hoveredProjId = closestRow.projectData ? closestRow.projectData.id : 'none';
        } else if (closestRow.type === 'task') {
          hoveredProjId = closestRow.data.projectId || 'none';
        } else if (closestRow.type === 'deadline-row') {
          hoveredProjId = closestRow.projectId || 'none';
        }
      }
      dragContext.hoveredProjId = hoveredProjId;

      // Retrieve current timeline parameters dynamically to prevent closure staleness during auto-scrolling
      const { viewportStartDate: curViewportStartDate, zoomMonths: curZoomMonths } = state.ui;
      const curTimelineStart = parseLocalDate(curViewportStartDate);
      const curTimelineEnd = new Date(curTimelineStart.getTime());
      curTimelineEnd.setMonth(curTimelineEnd.getMonth() + curZoomMonths);
      const curTotalDurationMs = curTimelineEnd.getTime() - curTimelineStart.getTime();
      const curViewport = document.getElementById('chartViewport');
      const curViewportWidth = curViewport ? (curViewport.clientWidth || 1000) : 1000;

      const targetTask = state.tasks.find(t => t.id === dragContext.taskId);
      if (targetTask) {
        if (dragContext.dragMode === 'move') {
          const targetX = relativeX - dragContext.mouseOffsetFromTaskStart;
          const targetDate = new Date(curTimelineStart.getTime() + (targetX / curViewportWidth) * curTotalDurationMs);
          let newOccStart = snapToNearestDay(targetDate);
          
          const diffMs = newOccStart.getTime() - parseLocalDate(dragContext.startOccurrenceStartDateStr).getTime();
          const newStart = new Date(parseLocalDate(dragContext.startStartDateStr).getTime() + diffMs);
          const durationWeeks = targetTask.durationWeeks || 4;
          const newEnd = new Date(newStart.getTime() + durationWeeks * 7 * 86400000);
          
          targetTask.startDate = formatDateToString(newStart);
          targetTask.endDate = formatDateToString(newEnd);
          targetTask.startType = 'date';
          targetTask.startAfterTaskId = null;
          
        } else if (dragContext.dragMode === 'resize-start') {
          const targetX = relativeX - dragContext.mouseOffsetFromTaskStart;
          const targetDate = new Date(curTimelineStart.getTime() + (targetX / curViewportWidth) * curTotalDurationMs);
          let newOccStart = snapToNearestDay(targetDate);
          const occEnd = parseLocalDate(dragContext.startOccurrenceEndDateStr);
          
          if (newOccStart < occEnd) {
            const diffMs = newOccStart.getTime() - parseLocalDate(dragContext.startOccurrenceStartDateStr).getTime();
            const newStart = new Date(parseLocalDate(dragContext.startStartDateStr).getTime() + diffMs);
            
            targetTask.startDate = formatDateToString(newStart);
            targetTask.durationWeeks = Math.max(1, Math.round((occEnd - newOccStart) / (7 * 86400000)));
            const newEnd = new Date(newStart.getTime() + targetTask.durationWeeks * 7 * 86400000);
            targetTask.endDate = formatDateToString(newEnd);
            targetTask.startType = 'date';
            targetTask.startAfterTaskId = null;
          }
          
        } else if (dragContext.dragMode === 'resize-end') {
          const targetX = relativeX + dragContext.mouseOffsetFromTaskEnd;
          const targetDate = new Date(curTimelineStart.getTime() + (targetX / curViewportWidth) * curTotalDurationMs);
          let newOccEnd = snapToNearestDay(targetDate);
          const occStart = parseLocalDate(dragContext.startOccurrenceStartDateStr);
          
          if (newOccEnd > occStart) {
            targetTask.durationWeeks = Math.max(1, Math.round((newOccEnd - occStart) / (7 * 86400000)));
            const finalEnd = new Date(parseLocalDate(targetTask.startDate).getTime() + targetTask.durationWeeks * 7 * 86400000);
            targetTask.endDate = formatDateToString(finalEnd);
          }
        }
        updateTaskDependencies(targetTask.id);
      }
      renderGanttChart();
    };
    
    const handleDragEnd = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      
      svg.classList.remove('drag-move-active');
      stopAutoScroll();
      
      if (dragContext) {
        const targetTask = state.tasks.find(t => t.id === dragContext.taskId);
        if (targetTask) {
          if (dragContext.dragMode === 'move') {
            const newProjId = dragContext.hoveredProjId;
            const oldProjId = dragContext.startProjectId;
            
            // Move project first if changed
            if (newProjId !== oldProjId) {
              const chainIds = getLinkedTaskChain(targetTask.id);
              chainIds.forEach(cid => {
                const t = state.tasks.find(x => x.id === cid);
                if (t) {
                  t.projectId = newProjId;
                }
              });
            }

            // Reordering logic
            let finalClosestRow = null;
            let finalMinDiff = Infinity;
            const finalRelativeY = dragContext.mouseRelativeY;
            
            renderedRows.forEach(row => {
              const rowHeightVal = row.type === 'group-header' ? groupHeaderHeight : row.type === 'deadline-row' ? row.rowHeight : rowHeight;
              const rowCenter = row.y + rowHeightVal / 2;
              const diff = Math.abs(finalRelativeY - rowCenter);
              if (diff < finalMinDiff) {
                finalMinDiff = diff;
                finalClosestRow = row;
              }
            });
            
            if (finalClosestRow) {
              const targetProjId = newProjId;
              const orderIds = dragContext.preDragOrder[targetProjId] || [];
              let projTasks = orderIds.map(id => state.tasks.find(x => x.id === id)).filter(Boolean);
              
              // Remove the target task if it is already present in target project list
              projTasks = projTasks.filter(t => t.id !== targetTask.id);
              
              let insertIdx = -1;
              if (finalClosestRow.type === 'task') {
                const neighborTask = finalClosestRow.data;
                const neighborIdx = projTasks.findIndex(t => t.id === neighborTask.id);
                if (neighborIdx !== -1) {
                  const neighborCenter = finalClosestRow.y + rowHeight / 2;
                  if (finalRelativeY < neighborCenter) {
                    insertIdx = neighborIdx;
                  } else {
                    insertIdx = neighborIdx + 1;
                  }
                }
              } else if (finalClosestRow.type === 'group-header' || finalClosestRow.type === 'deadline-row') {
                insertIdx = 0;
              }
              
              if (insertIdx !== -1) {
                projTasks.splice(insertIdx, 0, targetTask);
              } else {
                projTasks.push(targetTask);
              }
              
              // Assign sequential sortOrder values
              projTasks.forEach((t, index) => {
                t.sortOrder = index * 10;
              });

              // If project changed, also re-index the old project tasks
              if (newProjId !== oldProjId) {
                const oldOrderIds = dragContext.preDragOrder[oldProjId] || [];
                const oldProjTasks = oldOrderIds
                  .map(id => state.tasks.find(x => x.id === id))
                  .filter(Boolean)
                  .filter(t => t.id !== targetTask.id);
                
                oldProjTasks.forEach((t, index) => {
                  t.sortOrder = index * 10;
                });
              }
            }
          }
          
          // Snap start and end dates to nearest week on drag release
          const startD = parseLocalDate(targetTask.startDate);
          const snappedStart = snapToNearestWeek(startD);
          targetTask.startDate = formatDateToString(snappedStart);
          
          if (targetTask.endType === 'duration') {
            const durationWeeks = targetTask.durationWeeks || 4;
            const newEnd = new Date(snappedStart.getTime() + durationWeeks * 7 * 86400000);
            targetTask.endDate = formatDateToString(newEnd);
          } else {
            const endD = parseLocalDate(targetTask.endDate);
            const snappedEnd = snapToNearestWeek(endD);
            targetTask.endDate = formatDateToString(snappedEnd);
            targetTask.durationWeeks = Math.max(1, Math.round((snappedEnd - snappedStart) / (7 * 86400000)));
          }
          
          updateTaskDependencies(targetTask.id);
        }
        dragContext = null;
        saveState(true);
        syncDropdowns();
        populateSidebarFilters();
        renderDataTable();
        renderGanttChart();
      }
    };
    
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  }

  // 6. Draw individual Task Bars & Labels
  function renderTaskRow(row) {
    const task = row.data;
    const isDraggingThis = dragContext && dragContext.taskId === task.id && dragContext.dragMode === 'move' && dragContext.mouseRelativeY !== undefined && dragContext.mouseOffsetFromTaskTop !== undefined;
    
    // Get all years this task repeats in
    const years = getTaskIterationYears(task);
    
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'task-bar-group');
    if (dragContext && dragContext.taskId === task.id && dragContext.dragMode === 'move') {
      group.classList.add('dragging');
    }
    
    const barHeight = rowHeight - 12;
    
    years.forEach(y => {
      const occ = getTaskOccurrenceDates(task, y);
      const x = dateToX(occ.startDate);
      const x2 = dateToX(occ.endDate);
      const barWidth = Math.max(8, x2 - x);
      
      let barY;
      if (isDraggingThis) {
        barY = dragContext.mouseRelativeY - dragContext.mouseOffsetFromTaskTop;
      } else {
        barY = row.y + 4;
      }
      
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', barY);
      rect.setAttribute('width', barWidth);
      rect.setAttribute('height', barHeight);
      rect.setAttribute('fill', row.color);
      rect.setAttribute('opacity', '0.85');
      rect.setAttribute('class', 'task-bar-rect');
      
      // Dynamic cursors for resize/move on hover
      rect.addEventListener('mousemove', (e) => {
        if (dragContext) return;
        const bbox = rect.getBoundingClientRect();
        const mouseX = e.clientX - bbox.left;
        const handleSize = Math.min(12, bbox.width / 3);
        if (mouseX < handleSize) {
          rect.setAttribute('class', 'task-bar-rect resize-handle-left');
        } else if (mouseX > bbox.width - handleSize) {
          rect.setAttribute('class', 'task-bar-rect resize-handle-right');
        } else {
          rect.setAttribute('class', 'task-bar-rect drag-handle-move');
        }
      });
      
      rect.addEventListener('mouseleave', () => {
        if (!dragContext) {
          rect.setAttribute('class', 'task-bar-rect');
        }
      });
      
      // Drag handler setup
      rect.addEventListener('mousedown', (e) => {
        const bbox = rect.getBoundingClientRect();
        const mouseX = e.clientX - bbox.left;
        const handleSize = Math.min(12, bbox.width / 3);
        
        let dragMode = 'move';
        if (mouseX < handleSize) {
          dragMode = 'resize-start';
        } else if (mouseX > bbox.width - handleSize) {
          dragMode = 'resize-end';
        }
        
        initiateDrag(e, task, dragMode, y);
      });
      
      group.appendChild(rect);
      
      // Deciding label position for this occurrence: Inside if wide enough, otherwise outside
      const visibleStartX = Math.max(0, x);
      const visibleEndX = Math.min(viewportWidth, x2);
      const visibleWidth = Math.max(0, visibleEndX - visibleStartX);

      let label = task.name;
      const estimatedTextWidth = label.length * 6.5;
      const buttonsWidth = 62;
      const totalNeededWidth = estimatedTextWidth + buttonsWidth + 24;
      const isWide = visibleWidth > totalNeededWidth;
      
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      
      // Position label relative to the visible portion of this occurrence
      const textX = isWide ? visibleStartX + 8 : visibleEndX + 8;
      const textY = barY + (barHeight / 2) + 4;
      
      text.setAttribute('x', textX);
      text.setAttribute('y', textY);
      
      if (isDraggingThis) {
        text.setAttribute('fill', 'var(--text-primary)');
        text.setAttribute('class', 'task-text floating-drag-label');
      } else {
        if (isWide) {
          text.setAttribute('fill', 'var(--bg-secondary)');
          text.setAttribute('font-weight', '500');
        } else {
          text.setAttribute('fill', 'var(--text-primary)');
        }
        text.setAttribute('class', 'task-text');
      }
      
      text.textContent = label;
      
      // Support grabbing the task via clicking/dragging the text label
      text.addEventListener('mousedown', (e) => {
        initiateDrag(e, task, 'move', y);
      });
      
      group.appendChild(text);
      
      // Render Task Hover Action Buttons (Edit, Duplicate, Delete) next to labels
      const actionsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      actionsGroup.setAttribute('class', 'task-actions-group');
      
      const buttonsStartX = textX + estimatedTextWidth + 12;
      const buttonsCenterY = textY - 4.5;
      
      function createSvgButton(btnX, btnY, iconType, isInside, onClick) {
        const btn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        btn.setAttribute('class', `svg-action-btn${isInside ? '-inside' : ''} ${iconType === 'delete' ? 'delete' : ''}`);
        btn.setAttribute('transform', `translate(${btnX}, ${btnY})`);
        
        const buttonRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        buttonRect.setAttribute('width', '18');
        buttonRect.setAttribute('height', '18');
        btn.appendChild(buttonRect);
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        if (iconType === 'edit') {
          path.setAttribute('d', 'M3 15h3L14.5 6.5l-3-3L3 12v3M11.5 3.5l3 3');
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
        } else if (iconType === 'duplicate') {
          const innerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          innerRect.setAttribute('x', '3');
          innerRect.setAttribute('y', '6');
          innerRect.setAttribute('width', '8');
          innerRect.setAttribute('height', '8');
          innerRect.setAttribute('rx', '1.5');
          innerRect.setAttribute('ry', '1.5');
          innerRect.setAttribute('fill', 'none');
          innerRect.setAttribute('stroke-width', '1.2');
          btn.appendChild(innerRect);
          
          path.setAttribute('d', 'M6 3h7v7');
          path.setAttribute('stroke-linecap', 'round');
        } else if (iconType === 'delete') {
          path.setAttribute('d', 'M3 5h12M5 5v10a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V5M7 3h4');
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
        }
        
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-width', '1.2');
        btn.appendChild(path);
        
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        });
        
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        
        btn.addEventListener('mouseenter', (e) => {
          e.stopPropagation();
          hideTooltip();
        });
        
        return btn;
      }
      
      const editBtn = createSvgButton(buttonsStartX, buttonsCenterY - 9, 'edit', isWide && !isDraggingThis, () => {
        editTask(task.id);
      });
      const dupBtn = createSvgButton(buttonsStartX + 22, buttonsCenterY - 9, 'duplicate', isWide && !isDraggingThis, () => {
        duplicateTask(task.id);
      });
      const delBtn = createSvgButton(buttonsStartX + 44, buttonsCenterY - 9, 'delete', isWide && !isDraggingThis, () => {
        deleteTask(task.id);
      });
      
      actionsGroup.appendChild(editBtn);
      actionsGroup.appendChild(dupBtn);
      actionsGroup.appendChild(delBtn);
      group.appendChild(actionsGroup);
    });
    
    group.addEventListener('click', () => {
      editTask(task.id);
    });
    
    group.addEventListener('mouseenter', (e) => {
      if (dragContext) return;
      const assigneesList = task.assignee ? task.assignee.split(',').map(a => a.trim()).filter(Boolean) : [];
      let assigneeHtml = '';
      if (assigneesList.length === 0) {
        assigneeHtml = `<span class="assignee-badge unassigned">Unassigned</span>`;
      } else {
        assigneeHtml = assigneesList.map(a => `<span class="assignee-badge">${a}</span>`).join(' ');
      }
      const tooltipHtml = `
        <h4>${task.name}</h4>
        <div><strong>Start:</strong> ${task.startDate}</div>
        <div><strong>End:</strong> ${task.endDate}</div>
        <div><strong>Duration:</strong> ${task.durationWeeks} weeks</div>
        <div style="margin-top: 4px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;"><strong>Assignee(s):</strong> ${assigneeHtml}</div>
      `;
      showTooltip(e, tooltipHtml);
    });
    group.addEventListener('mouseleave', hideTooltip);
    svg.appendChild(group);
  }

  // Helper: create a small SVG icon button for project headers
  function createProjSvgBtn(x, y, iconType, onClick) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `svg-proj-action-btn${iconType === 'delete' ? ' delete-proj' : ''}`);
    g.setAttribute('transform', `translate(${x}, ${y})`);
    
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '20');
    bg.setAttribute('height', '20');
    bg.setAttribute('rx', '4');
    bg.setAttribute('ry', '4');
    g.appendChild(bg);
    
    if (iconType === 'edit') {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M4 16h3L15 8l-3-3L4 13v3M12 5l3 3');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-width', '1.4');
      p.setAttribute('stroke', 'var(--text-secondary)');
      g.appendChild(p);
    } else if (iconType === 'duplicate') {
      const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r2.setAttribute('class', 'icon-shape');
      r2.setAttribute('x', '3');
      r2.setAttribute('y', '7');
      r2.setAttribute('width', '8');
      r2.setAttribute('height', '8');
      r2.setAttribute('rx', '1.5');
      g.appendChild(r2);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M7 3h8v8');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-width', '1.4');
      p.setAttribute('stroke', 'var(--text-secondary)');
      g.appendChild(p);
    } else if (iconType === 'delete') {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M4 6h12M6 6v10a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 14 16V6M8 4h4');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-width', '1.4');
      p.setAttribute('stroke', 'var(--danger)');
      g.appendChild(p);
    }
    
    g.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    g.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    g.addEventListener('mouseenter', (e) => { e.stopPropagation(); hideTooltip(); });
    return g;
  }

  // 7. Draw Row Contents (Group Headers & Task Bars)
  let draggedTaskRow = null;
  renderedRows.forEach(row => {
    if (row.type === 'group-header') {
      // Wrap in a group so hover shows action buttons
      const headerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      headerGroup.setAttribute('class', 'proj-header-group');
      svg.appendChild(headerGroup);

      const groupBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      groupBg.setAttribute('x', 0);
      groupBg.setAttribute('y', row.y);
      groupBg.setAttribute('width', viewportWidth);
      groupBg.setAttribute('height', groupHeaderHeight - 8);
      
      let isHoveredDrop = false;
      if (dragContext && dragContext.dragMode === 'move') {
        const rowProjId = row.projectData ? row.projectData.id : 'none';
        if (dragContext.hoveredProjId === rowProjId) {
          isHoveredDrop = true;
        }
      }
      groupBg.setAttribute('fill', isHoveredDrop ? 'var(--accent-light)' : 'var(--bg-tertiary)');
      if (isHoveredDrop) {
        groupBg.setAttribute('stroke', 'var(--accent)');
        groupBg.setAttribute('stroke-width', '1.5');
      }
      groupBg.setAttribute('rx', '4');
      headerGroup.appendChild(groupBg);

      const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      pill.setAttribute('x', 4);
      pill.setAttribute('y', row.y + 4);
      pill.setAttribute('width', 4);
      pill.setAttribute('height', groupHeaderHeight - 16);
      pill.setAttribute('fill', row.color);
      pill.setAttribute('rx', '2');
      headerGroup.appendChild(pill);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', 16);
      text.setAttribute('y', row.y + 20);
      text.setAttribute('font-family', 'var(--font-display)');
      text.setAttribute('font-weight', '600');
      text.setAttribute('font-size', '13');
      text.setAttribute('fill', 'var(--text-primary)');
      
      let datesStr = '';
      if (row.projectData) {
        datesStr = ` (${row.projectData.startMonth} to ${row.projectData.endMonth})`;
      }
      text.textContent = row.label + datesStr;
      
      if (row.projectData) {
        text.style.cursor = 'pointer';
        text.addEventListener('dblclick', () => {
          editProject(row.projectData.id);
        });
      }
      headerGroup.appendChild(text);
      
      // Edit / Duplicate / Delete buttons (only for real projects, not General)
      if (row.projectData) {
        const fullLabel = row.label + datesStr;
        const estimatedLabelWidth = fullLabel.length * 7.8; // approx px at 13px weight-600
        const btnStartX = 16 + estimatedLabelWidth + 12;
        const btnY = row.y + (groupHeaderHeight - 8) / 2 - 10;
        const editBtn = createProjSvgBtn(btnStartX,      btnY, 'edit',      () => editProject(row.projectData.id));
        const dupBtn  = createProjSvgBtn(btnStartX + 24, btnY, 'duplicate', () => duplicateProject(row.projectData.id));
        const delBtn  = createProjSvgBtn(btnStartX + 48, btnY, 'delete',    () => deleteProject(row.projectData.id));
        headerGroup.appendChild(editBtn);
        headerGroup.appendChild(dupBtn);
        headerGroup.appendChild(delBtn);
      }
      
    } else if (row.type === 'deadline-row') {
      // ── Dedicated deadline row ──────────────────────────────────────
      const dlBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      dlBg.setAttribute('x', 0);
      dlBg.setAttribute('y', row.y);
      dlBg.setAttribute('width', viewportWidth);
      dlBg.setAttribute('height', row.rowHeight);
      dlBg.setAttribute('fill', 'var(--bg-tertiary)');
      dlBg.setAttribute('opacity', '0.6');
      svg.appendChild(dlBg);

      // "Deadlines" label on the left
      const dlLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      dlLabel.setAttribute('x', 10);
      dlLabel.setAttribute('y', row.y + row.rowHeight / 2 + 4);
      dlLabel.setAttribute('font-size', '11');
      dlLabel.setAttribute('font-family', 'var(--font-sans)');
      dlLabel.setAttribute('fill', 'var(--text-tertiary)');
      dlLabel.setAttribute('font-style', 'italic');
      dlLabel.setAttribute('user-select', 'none');
      dlLabel.textContent = 'Deadlines';
      svg.appendChild(dlLabel);

      // Left accent line matching the project colour
      const dlPill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      dlPill.setAttribute('x', 4);
      dlPill.setAttribute('y', row.y + 4);
      dlPill.setAttribute('width', 2);
      dlPill.setAttribute('height', row.rowHeight - 8);
      dlPill.setAttribute('fill', row.color);
      dlPill.setAttribute('rx', '1');
      svg.appendChild(dlPill);

      // Diamond markers and texts grouped into lanes
      const diaSize = 13;

      row.lanes.forEach((lane, laneIdx) => {
        const centerY = row.y + 14 + laneIdx * row.laneHeight;

        lane.forEach(item => {
          const dead = item.d;
          const deadX = item.deadX;

          const dia = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          const pts = `${deadX},${centerY - diaSize/2} ${deadX + diaSize/2},${centerY} ${deadX},${centerY + diaSize/2} ${deadX - diaSize/2},${centerY}`;
          dia.setAttribute('points', pts);
          dia.setAttribute('fill', 'var(--warning)');
          dia.setAttribute('stroke', 'var(--bg-secondary)');
          dia.setAttribute('stroke-width', '1.5');
          dia.setAttribute('class', 'deadline-diamond');
          dia.style.cursor = 'pointer';

          dia.addEventListener('click', (e) => { e.stopPropagation(); editDeadline(dead.id); });
          dia.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            let parentLabel = 'General Tasks';
            if (row.projectId !== 'none') {
              const project = state.projects.find(p => p.id === row.projectId);
              if (project) {
                parentLabel = project.name;
              }
            }
            showTooltip(e, `
              <h4 style="color:var(--warning)">⬦ ${dead.name}</h4>
              <div><strong>Date:</strong> ${dead.date}</div>
              <div style="font-size:0.7rem; color:var(--text-tertiary);">Project: "${parentLabel}"</div>
            `);
          });
          dia.addEventListener('mouseleave', hideTooltip);

          // Deadline name label (to the right of the diamond)
          const deadNameEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          deadNameEl.setAttribute('x', deadX + diaSize / 2 + 5);
          deadNameEl.setAttribute('y', centerY + 4.5);
          deadNameEl.setAttribute('font-size', '12');
          deadNameEl.setAttribute('font-family', 'var(--font-sans)');
          deadNameEl.setAttribute('fill', 'var(--warning)');
          deadNameEl.setAttribute('user-select', 'none');
          deadNameEl.textContent = dead.name;

          svg.appendChild(deadNameEl);
          svg.appendChild(dia); // Diamond on top of its label
        });
      });

    } else if (row.type === 'task') {
      if (dragContext && dragContext.taskId === row.data.id && dragContext.dragMode === 'move') {
        draggedTaskRow = row;
      } else {
        renderTaskRow(row);
      }
    }
  });

  if (draggedTaskRow) {
    renderTaskRow(draggedTaskRow);
  }
  
  // 6. Draw Timeline Header (Floating background at the top)
  const headerBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  headerBg.setAttribute('x', 0);
  headerBg.setAttribute('y', 0);
  headerBg.setAttribute('width', viewportWidth);
  headerBg.setAttribute('height', headerHeight);
  headerBg.setAttribute('class', 'svg-header-bg');
  if (headerSvg) {
    headerSvg.appendChild(headerBg);
  } else {
    svg.appendChild(headerBg);
  }
  
  // Draw minor labels
  columns.forEach(col => {
    const minorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    minorText.setAttribute('x', col.x + col.width / 2);
    minorText.setAttribute('y', headerHeight - 10);
    minorText.setAttribute('class', 'svg-header-text');
    minorText.textContent = col.minorLabel;
    if (headerSvg) {
      headerSvg.appendChild(minorText);
    } else {
      svg.appendChild(minorText);
    }
  });

  // Group columns into major label spans to prevent overlap and support sticky layout
  const majorSpans = [];
  columns.forEach(col => {
    if (majorSpans.length === 0 || majorSpans[majorSpans.length - 1].label !== col.majorLabel) {
      majorSpans.push({
        label: col.majorLabel,
        startX: col.x,
        endX: col.x + col.width,
        date: col.startDate
      });
    } else {
      majorSpans[majorSpans.length - 1].endX = col.x + col.width;
    }
  });

  majorSpans.forEach(span => {
    const visibleStart = Math.max(0, span.startX);
    const visibleEnd = Math.min(viewportWidth, span.endX);
    const visibleWidth = visibleEnd - visibleStart;

    let textContent = span.label;

    if (resolution === 'week') {
      const date = span.date;
      const longLabel = date.toLocaleString('en-US', { month: 'long', year: 'numeric' }); // "August 2026"
      const shortLabel = date.toLocaleString('en-US', { month: 'short', year: 'numeric' }); // "Aug 2026"
      const longMonth = date.toLocaleString('en-US', { month: 'long' }); // "August"
      const shortMonth = date.toLocaleString('en-US', { month: 'short' }); // "Aug"

      // Choose best fitting text content based on estimated width + padding
      if (visibleWidth >= longLabel.length * 7.5 + 8) {
        textContent = longLabel;
      } else if (visibleWidth >= shortLabel.length * 7.5 + 8) {
        textContent = shortLabel;
      } else if (visibleWidth >= longMonth.length * 7.5 + 8) {
        textContent = longMonth;
      } else if (visibleWidth >= shortMonth.length * 7.5 + 8) {
        textContent = shortMonth;
      } else {
        textContent = ''; // Hide if none fit
      }
    } else {
      // For other resolutions (trimester, semester, year, etc.)
      if (visibleWidth < span.label.length * 7.5 + 8) {
        textContent = '';
      }
    }

    if (textContent) {
      const majorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      // Sticky positioning: position the label at the visible start of the month,
      // but ensure it stays within the visible bounds of the month's span.
      const textWidth = textContent.length * 7.5;
      const x = Math.min(visibleStart + 4, visibleEnd - textWidth - 4);
      majorText.setAttribute('x', x);
      majorText.setAttribute('y', 20);
      majorText.setAttribute('class', 'svg-header-text-month');
      majorText.textContent = textContent;
      if (headerSvg) {
        headerSvg.appendChild(majorText);
      } else {
        svg.appendChild(majorText);
      }
    }
  });

  const headerBorder = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  headerBorder.setAttribute('x1', 0);
  headerBorder.setAttribute('y1', headerHeight);
  headerBorder.setAttribute('x2', viewportWidth);
  headerBorder.setAttribute('y2', headerHeight);
  headerBorder.setAttribute('stroke', 'var(--border-color)');
  headerBorder.setAttribute('stroke-width', '1.5');
  if (headerSvg) {
    headerSvg.appendChild(headerBorder);
  } else {
    svg.appendChild(headerBorder);
  }

  // 8. Draw Scroll Zone Indicators (hidden/low-opacity by default, light up on drag/hover)
  const leftIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  leftIndicator.setAttribute('id', 'leftScrollZone');
  leftIndicator.setAttribute('x', 0);
  leftIndicator.setAttribute('y', headerHeight);
  leftIndicator.setAttribute('width', 50);
  leftIndicator.setAttribute('height', totalHeight - headerHeight);
  leftIndicator.setAttribute('class', 'scroll-zone-indicator left');
  svg.appendChild(leftIndicator);

  const rightIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rightIndicator.setAttribute('id', 'rightScrollZone');
  rightIndicator.setAttribute('x', viewportWidth - 50);
  rightIndicator.setAttribute('y', headerHeight);
  rightIndicator.setAttribute('width', 50);
  rightIndicator.setAttribute('height', totalHeight - headerHeight);
  rightIndicator.setAttribute('class', 'scroll-zone-indicator right');
  svg.appendChild(rightIndicator);

  // Refresh timeline-start slider bounds to reflect current data extents
  updateTimelineStartSlider();
  return totalHeight;
}

// ==========================================
// TOOLTIP FLOATING ELEMENT
// ==========================================

function showTooltip(e, html) {
  const tooltip = document.getElementById('ganttTooltip');
  const viewport = document.getElementById('chartViewport');
  if (!tooltip || !viewport) return;
  
  tooltip.innerHTML = html;
  tooltip.style.display = 'flex';
  
  // Calculate relative bounds
  const rect = viewport.getBoundingClientRect();
  const cursorX = e.clientX - rect.left + viewport.scrollLeft;
  const cursorY = e.clientY - rect.top + viewport.scrollTop;
  
  let x = cursorX + 15;
  let y = cursorY + 15;
  
  // Constrain horizontal position
  if (x + tooltip.offsetWidth > viewport.scrollLeft + viewport.clientWidth) {
    x = cursorX - tooltip.offsetWidth - 15;
  }
  x = Math.max(viewport.scrollLeft + 5, x);
  
  // Constrain vertical position
  const headerHeight = 50; // Keep tooltip below sticky header
  const minY = viewport.scrollTop + headerHeight + 5;
  const maxY = viewport.scrollTop + viewport.clientHeight - tooltip.offsetHeight - 5;
  
  if (y + tooltip.offsetHeight > viewport.scrollTop + viewport.clientHeight) {
    y = cursorY - tooltip.offsetHeight - 15;
  }
  
  if (maxY >= minY) {
    y = Math.max(minY, Math.min(maxY, y));
  } else {
    y = minY;
  }
  
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  const tooltip = document.getElementById('ganttTooltip');
  if (tooltip) tooltip.style.display = 'none';
}

// ==========================================
// UNIFIED DATA TABLE LIST VIEW
// ==========================================

function renderDataTable() {
  const tbody = document.getElementById('dataTableBody');
  const badge = document.getElementById('activeFiltersBadge');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  const filteredProjects = state.projects.filter(p => 
    state.ui.filterProjects.includes(p.id)
  );
  
  // Filter Tasks (ticked projects/assignees only)
  const filteredTasks = state.tasks.filter(t => {
    const pId = t.projectId || 'none';
    if (pId === 'none') {
      if (!state.ui.filterProjects.includes('none')) return false;
    } else {
      if (!state.ui.filterProjects.includes(pId)) return false;
    }
    
    const taskAssignees = t.assignee ? t.assignee.split(',').map(a => a.trim()).filter(Boolean) : [];
    if (taskAssignees.length === 0) {
      taskAssignees.push('Unassigned');
    }
    const hasMatch = taskAssignees.some(a => state.ui.filterAssignees.includes(a));
    if (!hasMatch) return false;
    
    return true;
  });

  // Filter Deadlines
  const filteredDeadlines = state.deadlines.filter(d => {
    const pId = d.projectId || 'none';
    return state.ui.filterProjects.includes(pId);
  });

  const totalFilteredCount = filteredTasks.length + filteredDeadlines.length;
  const totalRawCount = state.tasks.length + state.deadlines.length;
  
  if (badge) {
    const allProjectsCount = state.projects.length + 1; // plus 'none'
    const uniqueAssignees = new Set();
    let hasUnassigned = false;
    state.tasks.forEach(t => {
      if (t.assignee && t.assignee.trim()) {
        t.assignee.split(',').map(a => a.trim()).filter(Boolean).forEach(a => uniqueAssignees.add(a));
      } else {
        hasUnassigned = true;
      }
    });
    const allAssigneesCount = uniqueAssignees.size + (hasUnassigned ? 1 : 0);
    const filtersActive = (state.ui.filterProjects.length < allProjectsCount) || (state.ui.filterAssignees.length < allAssigneesCount);

    if (filtersActive) {
      badge.textContent = `Showing ${totalFilteredCount} of ${totalRawCount} items (Filters Active)`;
    } else {
      badge.textContent = `Showing all ${totalRawCount} items`;
    }
  }
  
  // Render empty state
  if (totalFilteredCount === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          No activities or deadlines fit the current filters. Click "Add Task" to create one.
        </td>
      </tr>
    `;
    return;
  }
  
  // Combine tasks & deadlines, sorted by start/exact date
  const items = [];
  
  filteredTasks.forEach(t => {
    const proj = state.projects.find(p => p.id === t.projectId);
    items.push({
      id: t.id,
      type: 'Task',
      name: t.name,
      projectName: proj ? proj.name : 'General Tasks',
      colorIndex: proj ? proj.colorIndex : 8,
      startDate: t.startDate,
      endDate: t.endDate,
      duration: t.durationWeeks,
      assignee: t.assignee || 'Unassigned',
      raw: t
    });
  });
  
  filteredDeadlines.forEach(d => {
    const proj = state.projects.find(p => p.id === d.projectId);
    items.push({
      id: d.id,
      type: 'Deadline',
      name: d.name,
      projectName: proj ? proj.name : 'General Tasks',
      colorIndex: proj ? proj.colorIndex : 8,
      startDate: 'N/A',
      endDate: d.date,
      duration: 'N/A',
      assignee: 'N/A',
      raw: d
    });
  });
  
  // Sort items: Deadlines/tasks by start/exact date ascending
  items.sort((a, b) => {
    const dateA = a.startDate === 'N/A' ? a.endDate : a.startDate;
    const dateB = b.startDate === 'N/A' ? b.endDate : b.startDate;
    return dateA.localeCompare(dateB);
  });
  
  items.forEach(item => {
    const tr = document.createElement('tr');
    const colorClass = PALETTE[item.colorIndex] ? PALETTE[item.colorIndex].class : 'proj-color-9';
    
    let assigneeHtml = '';
    if (item.type === 'Deadline') {
      assigneeHtml = 'N/A';
    } else {
      const assigneesList = item.assignee ? item.assignee.split(',').map(a => a.trim()).filter(Boolean) : [];
      if (assigneesList.length === 0) {
        assigneeHtml = `<span class="assignee-badge unassigned">Unassigned</span>`;
      } else {
        assigneeHtml = assigneesList.map(a => `<span class="assignee-badge">${a}</span>`).join(' ');
      }
    }
    
    tr.innerHTML = `
      <td>
        <span class="color-indicator" style="background: var(--${colorClass})"></span>
        <strong style="margin-left: 4px;">${item.name}</strong>
      </td>
      <td>
        <span style="font-size:0.75rem; font-weight:600; text-transform:uppercase; padding: 2px 6px; border-radius: 4px; background: ${item.type === 'Task' ? 'var(--accent-light)' : 'var(--danger-light)'}; color: ${item.type === 'Task' ? 'var(--accent)' : 'var(--danger)'};">
          ${item.type}
        </span>
      </td>
      <td>${item.projectName}</td>
      <td>${item.startDate}</td>
      <td>${item.endDate}</td>
      <td>${item.duration}</td>
      <td>${assigneeHtml}</td>
      <td style="text-align: right;">
        <div class="actions-cell" style="justify-content: flex-end;">
          <button class="action-btn-mini" onclick="${item.type === 'Task' ? `editTask` : `editDeadline`}('${item.id}')" title="Edit Item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/>
            </svg>
          </button>
          ${item.type === 'Task' ? `
            <button class="action-btn-mini" onclick="duplicateTask('${item.id}')" title="Duplicate Task">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          ` : ''}
          <button class="action-btn-mini delete" onclick="${item.type === 'Task' ? `deleteTask` : `deleteDeadline`}('${item.id}')" title="Delete Item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// SIDEBAR FILTER LIST CONTROLS
// ==========================================

function populateSidebarFilters() {
  const projContainer = document.getElementById('projectFiltersContainer');
  const assigneeContainer = document.getElementById('assigneeFiltersContainer');
  if (!projContainer || !assigneeContainer) return;
  
  // 1. Project Filters
  projContainer.innerHTML = '';
  
  // Render General Tasks as a Project filter
  const generalDiv = document.createElement('div');
  generalDiv.className = 'filter-item';
  const isGeneralChecked = state.ui.filterProjects.includes('none');
  generalDiv.innerHTML = `
    <input type="checkbox" id="filter-proj-none" ${isGeneralChecked ? 'checked' : ''} onchange="toggleProjectFilter('none')">
    <span class="color-indicator" style="background: var(--text-tertiary)"></span>
    <label for="filter-proj-none" style="cursor:pointer; flex: 1;">General Tasks</label>
  `;
  projContainer.appendChild(generalDiv);

  state.projects.forEach(p => {
    const div = document.createElement('div');
    div.className = 'filter-item';
    const isChecked = state.ui.filterProjects.includes(p.id);
    const colorClass = PALETTE[p.colorIndex] ? PALETTE[p.colorIndex].class : 'proj-color-9';
    
    div.innerHTML = `
      <input type="checkbox" id="filter-proj-${p.id}" ${isChecked ? 'checked' : ''} onchange="toggleProjectFilter('${p.id}')">
      <span class="color-indicator" style="background: var(--${colorClass})"></span>
      <label for="filter-proj-${p.id}" style="cursor:pointer; flex: 1;">${p.name}</label>
    `;
    projContainer.appendChild(div);
  });
  
  // 2. Assignee Filters
  assigneeContainer.innerHTML = '';
  // Extract all unique assignees and check if unassigned exists
  const assignees = new Set();
  let hasUnassigned = false;
  state.tasks.forEach(t => {
    if (t.assignee && t.assignee.trim()) {
      t.assignee.split(',').map(a => a.trim()).filter(Boolean).forEach(a => assignees.add(a));
    } else {
      hasUnassigned = true;
    }
  });
  
  const sortedAssignees = Array.from(assignees).sort();
  if (hasUnassigned) {
    sortedAssignees.push('Unassigned');
  }

  sortedAssignees.forEach(name => {
    const div = document.createElement('div');
    div.className = 'filter-item';
    const isChecked = state.ui.filterAssignees.includes(name);
    
    div.innerHTML = `
      <input type="checkbox" id="filter-assignee-${encodeURIComponent(name)}" ${isChecked ? 'checked' : ''} onchange="toggleAssigneeFilter('${name.replace(/'/g, "\\'")}')">
      <label for="filter-assignee-${encodeURIComponent(name)}" style="cursor:pointer; flex: 1;">${name}</label>
    `;
    assigneeContainer.appendChild(div);
  });
  
  if (sortedAssignees.length === 0) {
    assigneeContainer.innerHTML = `<span style="font-size:0.75rem; color:var(--text-tertiary);">No assignees assigned</span>`;
  }
}

function toggleProjectFilter(projectId) {
  const index = state.ui.filterProjects.indexOf(projectId);
  if (index === -1) {
    state.ui.filterProjects.push(projectId);
  } else {
    state.ui.filterProjects.splice(index, 1);
  }
  saveState();
  renderGanttChart();
  renderDataTable();
}

function toggleAssigneeFilter(name) {
  const index = state.ui.filterAssignees.indexOf(name);
  if (index === -1) {
    state.ui.filterAssignees.push(name);
  } else {
    state.ui.filterAssignees.splice(index, 1);
  }
  saveState();
  renderGanttChart();
  renderDataTable();
}

// ==========================================
// MODAL MANAGEMENT
// ==========================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
  
  // Special cleaning on close
  if (modalId === 'taskModal') {
    hideAssigneeAutocomplete();
  }
}



// Reset standard confirmation dialog values
let confirmCallback = null;

function showConfirmationModal(title, message, isDanger, onConfirm, doubleConfirm = false) {
  const modal = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmTitle');
  const msgEl = document.getElementById('confirmMessage');
  const headerEl = modal.querySelector('.modal-header');
  const acceptBtn = document.getElementById('confirmAcceptBtn');
  const doubleContainer = document.getElementById('doubleConfirmCheckboxContainer');
  const doubleCheck = document.getElementById('doubleConfirmCheck');
  
  titleEl.textContent = title;
  msgEl.textContent = message;
  
  if (isDanger) {
    headerEl.style.background = 'var(--danger-light)';
    titleEl.className = 'text-danger';
    acceptBtn.className = 'btn btn-danger';
  } else {
    headerEl.style.background = 'var(--bg-tertiary)';
    titleEl.className = '';
    acceptBtn.className = 'btn btn-primary';
  }
  
  if (doubleConfirm) {
    doubleContainer.classList.remove('hidden');
    doubleCheck.checked = false;
    acceptBtn.disabled = true;
    
    // Require double check to enable confirm button
    doubleCheck.onchange = () => {
      acceptBtn.disabled = !doubleCheck.checked;
    };
  } else {
    doubleContainer.classList.add('hidden');
    acceptBtn.disabled = false;
  }
  
  confirmCallback = () => {
    onConfirm();
    closeModal('confirmModal');
  };
  
  acceptBtn.onclick = confirmCallback;
  openModal('confirmModal');
}

// Reset linked action dialog values
let linkedActionSingleCallback = null;
let linkedActionChainCallback = null;

function showLinkedActionModal(title, message, isDanger, onSingle, onChain) {
  const modal = document.getElementById('linkedActionModal');
  const titleEl = document.getElementById('linkedActionTitle');
  const msgEl = document.getElementById('linkedActionMessage');
  const singleBtn = document.getElementById('linkedActionSingleBtn');
  const chainBtn = document.getElementById('linkedActionChainBtn');
  
  titleEl.textContent = title;
  msgEl.textContent = message;
  
  if (isDanger) {
    singleBtn.className = 'btn btn-danger';
    chainBtn.className = 'btn btn-danger';
  } else {
    singleBtn.className = 'btn btn-primary';
    chainBtn.className = 'btn btn-primary';
  }
  
  linkedActionSingleCallback = () => {
    onSingle();
    closeModal('linkedActionModal');
  };
  
  linkedActionChainCallback = () => {
    onChain();
    closeModal('linkedActionModal');
  };
  
  singleBtn.onclick = linkedActionSingleCallback;
  chainBtn.onclick = linkedActionChainCallback;
  
  openModal('linkedActionModal');
}

function addAssigneePill(name) {
  const cleanName = name.trim();
  if (!cleanName) return;
  
  const container = document.getElementById('taskAssigneesContainer');
  if (!container) return;
  
  // Check if already exists
  const existingPills = container.querySelectorAll('.assignee-pill');
  for (let pill of existingPills) {
    if (pill.dataset.name.toLowerCase() === cleanName.toLowerCase()) {
      return;
    }
  }
  
  const pill = document.createElement('div');
  pill.className = 'assignee-pill';
  pill.dataset.name = cleanName;
  
  const span = document.createElement('span');
  span.textContent = cleanName;
  
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'assignee-pill-remove';
  removeBtn.innerHTML = '&times;';
  removeBtn.title = `Remove ${cleanName}`;
  removeBtn.onclick = () => pill.remove();
  
  pill.appendChild(span);
  pill.appendChild(removeBtn);
  container.appendChild(pill);
}

// ==========================================
// AUTOCOMPLETE FOR ASSIGNEES
// ==========================================

let highlightedAutocompleteIndex = -1;
let autocompleteList = [];

function setupAssigneeAutocomplete() {
  const input = document.getElementById('taskAssigneeInput');
  const dropdown = document.getElementById('assigneeAutocomplete');
  if (!input || !dropdown) return;
  
  // Collect unique assignees
  input.addEventListener('input', () => {
    let val = input.value;
    if (val.includes(',')) {
      const parts = val.split(',');
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i].trim();
        if (part) {
          addAssigneePill(part);
        }
      }
      input.value = parts[parts.length - 1].trimLeft();
      val = input.value;
    }
    
    const query = val.trim().toLowerCase();
    
    // Gather names by splitting existing assignees
    const names = new Set();
    state.tasks.forEach(t => {
      if (t.assignee && t.assignee.trim()) {
        t.assignee.split(',').map(a => a.trim()).filter(Boolean).forEach(a => names.add(a));
      }
    });
    
    // Filter out names that are already added as pills
    const container = document.getElementById('taskAssigneesContainer');
    const existingNames = new Set();
    if (container) {
      container.querySelectorAll('.assignee-pill').forEach(pill => {
        existingNames.add(pill.dataset.name.toLowerCase());
      });
    }
    
    autocompleteList = Array.from(names).filter(n => 
      n.toLowerCase().includes(query) && 
      n.toLowerCase() !== query &&
      !existingNames.has(n.toLowerCase())
    ).sort();
    
    if (autocompleteList.length > 0 && query.length > 0) {
      highlightedAutocompleteIndex = -1;
      renderAutocompleteDropdown();
    } else {
      hideAssigneeAutocomplete();
    }
  });
  
  // Handle keys: ArrowDown, ArrowUp, Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Always prevent form submit when pressing Enter in assignee input
      
      if (dropdown.style.display === 'block' && highlightedAutocompleteIndex >= 0 && highlightedAutocompleteIndex < autocompleteList.length) {
        selectAutocompleteName(autocompleteList[highlightedAutocompleteIndex]);
      } else {
        const val = input.value.trim();
        if (val) {
          addAssigneePill(val);
          input.value = '';
          hideAssigneeAutocomplete();
        }
      }
    } else if (dropdown.style.display === 'block') {
      const items = dropdown.querySelectorAll('.autocomplete-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedAutocompleteIndex = (highlightedAutocompleteIndex + 1) % autocompleteList.length;
        updateAutocompleteSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedAutocompleteIndex = (highlightedAutocompleteIndex - 1 + autocompleteList.length) % autocompleteList.length;
        updateAutocompleteSelection(items);
      } else if (e.key === 'Escape') {
        hideAssigneeAutocomplete();
      }
    }
  });
  
  // Close suggestions when input loses focus (slight delay to process clicks)
  input.addEventListener('blur', () => {
    setTimeout(hideAssigneeAutocomplete, 180);
  });
}

function renderAutocompleteDropdown() {
  const dropdown = document.getElementById('assigneeAutocomplete');
  const input = document.getElementById('taskAssigneeInput');
  if (!dropdown) return;
  
  dropdown.innerHTML = '';
  autocompleteList.forEach((name, idx) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.textContent = name;
    item.onclick = () => selectAutocompleteName(name);
    dropdown.appendChild(item);
  });
  
  dropdown.style.display = 'block';
}

function updateAutocompleteSelection(items) {
  items.forEach((item, idx) => {
    if (idx === highlightedAutocompleteIndex) {
      item.classList.add('selected');
      // Scroll into view if needed
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function selectAutocompleteName(name) {
  addAssigneePill(name);
  const input = document.getElementById('taskAssigneeInput');
  if (input) {
    input.value = '';
  }
  hideAssigneeAutocomplete();
}

function hideAssigneeAutocomplete() {
  const dropdown = document.getElementById('assigneeAutocomplete');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
  highlightedAutocompleteIndex = -1;
}

// ==========================================
// CRUD PROJECT HANDLING
// ==========================================

function setupProjectFormColorSelector() {
  const selector = document.getElementById('projectPaletteSelector');
  if (!selector) return;
  
  selector.innerHTML = '';
  PALETTE.forEach((color, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-color-btn ${color.class}`;
    btn.style.backgroundColor = color.value;
    btn.title = color.name;
    btn.onclick = () => selectProjectColor(index);
    selector.appendChild(btn);
  });
}

function selectProjectColor(index) {
  document.getElementById('projectColorIndex').value = index;
  const buttons = document.querySelectorAll('.palette-color-btn');
  buttons.forEach((btn, idx) => {
    if (idx === index) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
}

function addProject() {
  document.getElementById('projectModalTitle').textContent = 'Add Project';
  document.getElementById('projectIdField').value = '';
  document.getElementById('projectNameInput').value = '';
  
  // Set default months
  const now = new Date();
  const currentMonthStr = formatMonthToString(now.getFullYear(), now.getMonth());
  const nextYearMonthStr = formatMonthToString(now.getFullYear() + 1, now.getMonth());
  document.getElementById('projectStartMonth').value = currentMonthStr;
  document.getElementById('projectEndMonth').value = nextYearMonthStr;
  
  selectProjectColor(0);
  openModal('projectModal');
}

function editProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  
  document.getElementById('projectModalTitle').textContent = 'Edit Project';
  document.getElementById('projectIdField').value = project.id;
  document.getElementById('projectNameInput').value = project.name;
  document.getElementById('projectStartMonth').value = project.startMonth;
  document.getElementById('projectEndMonth').value = project.endMonth;
  
  selectProjectColor(project.colorIndex);
  openModal('projectModal');
}

function handleProjectSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('projectIdField').value;
  const name = document.getElementById('projectNameInput').value.trim();
  const colorIndex = parseInt(document.getElementById('projectColorIndex').value, 10);
  const startMonth = document.getElementById('projectStartMonth').value;
  const endMonth = document.getElementById('projectEndMonth').value;
  
  // Validate months range
  if (startMonth > endMonth) {
    alert("Project Start Month cannot be later than End Month.");
    return;
  }
  
  if (id) {
    // Edit existing project
    const project = state.projects.find(p => p.id === id);
    if (project) {
      project.name = name;
      project.colorIndex = colorIndex;
      project.startMonth = startMonth;
      project.endMonth = endMonth;
    }
  } else {
    // Create new project
    const newProj = {
      id: 'proj-' + Math.random().toString(36).substr(2, 9),
      name,
      colorIndex,
      startMonth,
      endMonth
    };
    state.projects.push(newProj);
    // Auto-tick new project
    if (!state.ui.filterProjects.includes(newProj.id)) {
      state.ui.filterProjects.push(newProj.id);
    }
  }
  
  saveState(true);
  closeModal('projectModal');
  syncDropdowns();
  populateSidebarFilters();
  renderGanttChart();
  renderDataTable();
}

function duplicateProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  
  const projectTasks = state.tasks.filter(t => t.projectId === id);
  
  // Populate modal
  document.getElementById('duplicateProjectName').textContent = `"${project.name}"`;
  document.getElementById('duplicateCopyTasks').checked = true;
  document.getElementById('duplicateCopyDeadlines').checked = true;
  
  // Decoupled checkboxes: remove onchange listener and reset opacity
  const tasksCheck = document.getElementById('duplicateCopyTasks');
  const deadlinesCheck = document.getElementById('duplicateCopyDeadlines');
  const deadlinesContainer = document.getElementById('duplicateCopyDeadlinesContainer');
  
  tasksCheck.onchange = null;
  deadlinesContainer.style.opacity = '1';
  
  const confirmBtn = document.getElementById('duplicateProjectConfirmBtn');
  confirmBtn.onclick = () => {
    const copyTasks = document.getElementById('duplicateCopyTasks').checked;
    const copyDeadlines = document.getElementById('duplicateCopyDeadlines').checked;
    
    // Create new project
    const newProjId = 'proj-' + Math.random().toString(36).substr(2, 9);
    const newProject = {
      ...project,
      id: newProjId,
      name: `${project.name} (Copy)`
    };
    state.projects.push(newProject);
    
    const taskIdMap = {}; // oldId -> newId
    
    if (copyTasks) {
      projectTasks.forEach(task => {
        const newTaskId = 'task-' + Math.random().toString(36).substr(2, 9);
        taskIdMap[task.id] = newTaskId;
        const newTask = {
          ...task,
          id: newTaskId,
          projectId: newProjId,
          startAfterTaskId: null, // resolved below
          startType: 'date'
        };
        state.tasks.push(newTask);
      });
      
      // Fix dependencies inside the copied task set
      Object.keys(taskIdMap).forEach(oldId => {
        const originalTask = state.tasks.find(t => t.id === oldId);
        const newTask = state.tasks.find(t => t.id === taskIdMap[oldId]);
        if (originalTask && newTask && originalTask.startAfterTaskId && taskIdMap[originalTask.startAfterTaskId]) {
          newTask.startAfterTaskId = taskIdMap[originalTask.startAfterTaskId];
          newTask.startType = 'dependency';
        }
      });
    }

    if (copyDeadlines) {
      const projDeadlines = state.deadlines.filter(d => d.projectId === id);
      projDeadlines.forEach(dead => {
        const newDead = {
          ...dead,
          id: 'dead-' + Math.random().toString(36).substr(2, 9),
          projectId: newProjId
        };
        state.deadlines.push(newDead);
      });
    }
    
    closeModal('duplicateProjectModal');
    saveState(true);
    syncDropdowns();
    populateSidebarFilters();
    renderGanttChart();
    renderDataTable();
  };
  
  openModal('duplicateProjectModal');
}

function deleteProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  
  const projectTasks = state.tasks.filter(t => t.projectId === id);
  const projectTaskIds = projectTasks.map(t => t.id);
  const projectDeadlines = state.deadlines.filter(d => d.projectId === id);
  
  // Populate modal
  document.getElementById('deleteProjectName').textContent = `"${project.name}"`;
  
  const taskCountEl = document.getElementById('deleteProjectTaskCount');
  taskCountEl.textContent = `This project contains ${projectTasks.length} task(s) and ${projectDeadlines.length} deadline(s).`;
  
  // Reset radio to default
  document.getElementById('deleteOptMove').checked = true;
  
  const confirmBtn = document.getElementById('deleteProjectConfirmBtn');
  confirmBtn.onclick = () => {
    const action = document.querySelector('input[name="deleteProjectAction"]:checked').value;
    
    if (action === 'move') {
      // Move tasks and deadlines to General (projectId = 'none')
      state.tasks.forEach(t => {
        if (t.projectId === id) {
          t.projectId = 'none';
        }
      });
      state.deadlines.forEach(d => {
        if (d.projectId === id) {
          d.projectId = 'none';
        }
      });
    } else {
      // Delete all tasks and the project's deadlines
      state.tasks = state.tasks.filter(t => t.projectId !== id);
      state.deadlines = state.deadlines.filter(d => d.projectId !== id);
      
      // Clear dependency links pointing to deleted tasks
      state.tasks.forEach(t => {
        if (projectTaskIds.includes(t.startAfterTaskId)) {
          t.startAfterTaskId = null;
          t.startType = 'date';
        }
      });
    }
    
    // Remove the project itself
    state.projects = state.projects.filter(p => p.id !== id);
    
    // Remove the project from active filters if present
    const fIdx = state.ui.filterProjects.indexOf(id);
    if (fIdx !== -1) state.ui.filterProjects.splice(fIdx, 1);
    
    closeModal('deleteProjectModal');
    saveState(true);
    syncDropdowns();
    populateSidebarFilters();
    renderGanttChart();
    renderDataTable();
  };
  
  openModal('deleteProjectModal');
}

// ==========================================
// CRUD TASK HANDLING
// ==========================================

function setTaskStartType(type) {
  document.getElementById('taskStartType').value = type;
  const dateBtn = document.getElementById('startTypeDateBtn');
  const depBtn = document.getElementById('startTypeDependencyBtn');
  const dateContainer = document.getElementById('taskStartInputContainer');
  const depContainer = document.getElementById('taskStartDependencyContainer');
  
  if (type === 'date') {
    dateBtn.classList.add('active');
    depBtn.classList.remove('active');
    dateContainer.classList.remove('hidden');
    depContainer.classList.add('hidden');
    document.getElementById('taskStartDate').required = true;
  } else {
    dateBtn.classList.remove('active');
    depBtn.classList.add('active');
    dateContainer.classList.add('hidden');
    depContainer.classList.remove('hidden');
    document.getElementById('taskStartDate').required = false;
  }
}

function setTaskEndType(type) {
  document.getElementById('taskEndType').value = type;
  const durBtn = document.getElementById('endTypeDurationBtn');
  const dateBtn = document.getElementById('endTypeDateBtn');
  const durContainer = document.getElementById('taskDurationInputContainer');
  const dateContainer = document.getElementById('taskEndDateContainer');
  
  if (type === 'duration') {
    durBtn.classList.add('active');
    dateBtn.classList.remove('active');
    durContainer.classList.remove('hidden');
    dateContainer.classList.add('hidden');
    document.getElementById('taskDurationWeeks').required = true;
  } else {
    durBtn.classList.remove('active');
    dateBtn.classList.add('active');
    durContainer.classList.add('hidden');
    dateContainer.classList.remove('hidden');
    document.getElementById('taskDurationWeeks').required = false;
    
    // Set default end date matching current start date + duration weeks
    const startDateVal = document.getElementById('taskStartDate').value;
    if (startDateVal) {
      const sDate = parseLocalDate(startDateVal);
      const weeks = parseInt(document.getElementById('taskDurationWeeks').value, 10) || 4;
      const eDate = new Date(sDate.getTime() + weeks * 7 * 86400000);
      document.getElementById('taskEndDate').value = formatDateToString(eDate);
    }
  }
}

function addTask() {
  // Load predecessors excluding none
  syncPredecessorDropdown('');
  
  document.getElementById('taskModalTitle').textContent = 'Add Task';
  document.getElementById('taskIdField').value = '';
  document.getElementById('taskNameInput').value = '';
  document.getElementById('taskAssigneeInput').value = '';
  const container = document.getElementById('taskAssigneesContainer');
  if (container) container.innerHTML = '';
  document.getElementById('taskPredecessorSelect').value = '';
  document.getElementById('taskProjectSelect').value = 'none';
  document.getElementById('taskRecurrenceCheck').checked = false;
  
  // Set default dates
  const today = new Date();
  document.getElementById('taskStartDate').value = formatDateToString(today);
  document.getElementById('taskDurationWeeks').value = 4;
  
  setTaskStartType('date');
  setTaskEndType('duration');
  
  openModal('taskModal');
}

function editTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  
  // Load predecessors excluding this task to avoid self-cycles
  syncPredecessorDropdown(task.id);
  
  document.getElementById('taskModalTitle').textContent = 'Edit Task';
  document.getElementById('taskIdField').value = task.id;
  document.getElementById('taskProjectSelect').value = task.projectId || 'none';
  document.getElementById('taskNameInput').value = task.name;
  document.getElementById('taskStartDate').value = task.startDate;
  document.getElementById('taskPredecessorSelect').value = task.startAfterTaskId || '';
  document.getElementById('taskDurationWeeks').value = task.durationWeeks || 4;
  document.getElementById('taskEndDate').value = task.endDate || '';
  document.getElementById('taskAssigneeInput').value = '';
  
  const container = document.getElementById('taskAssigneesContainer');
  if (container) {
    container.innerHTML = '';
    if (task.assignee && task.assignee.trim()) {
      task.assignee.split(',').map(a => a.trim()).filter(Boolean).forEach(name => {
        addAssigneePill(name);
      });
    }
  }
  
  document.getElementById('taskRecurrenceCheck').checked = false; // reset
  
  setTaskStartType(task.startType || 'date');
  setTaskEndType(task.endType || 'duration');
  
  openModal('taskModal');
}

function handleTaskSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('taskIdField').value;
  const projectId = document.getElementById('taskProjectSelect').value;
  const name = document.getElementById('taskNameInput').value.trim();
  const startType = document.getElementById('taskStartType').value;
  const startAfterTaskId = document.getElementById('taskPredecessorSelect').value;
  const endType = document.getElementById('taskEndType').value;
  const durationInput = parseInt(document.getElementById('taskDurationWeeks').value, 10);
  
  const assigneePillNames = [];
  const container = document.getElementById('taskAssigneesContainer');
  if (container) {
    container.querySelectorAll('.assignee-pill').forEach(pill => {
      assigneePillNames.push(pill.dataset.name);
    });
  }
  // Include any typed text that wasn't submitted as a pill
  const inputVal = document.getElementById('taskAssigneeInput').value.trim();
  if (inputVal && !assigneePillNames.includes(inputVal)) {
    assigneePillNames.push(inputVal);
  }
  const assignee = assigneePillNames.join(', ');
  const repeatAcrossYears = document.getElementById('taskRecurrenceCheck').checked;
  
  let startDate = '';
  if (startType === 'date') {
    startDate = document.getElementById('taskStartDate').value;
  } else {
    // Starts after predecessor ends
    const predecessor = state.tasks.find(t => t.id === startAfterTaskId);
    if (predecessor) {
      startDate = predecessor.endDate;
    } else {
      alert("Invalid Preceding Task chosen.");
      return;
    }
  }
  
  let durationWeeks = durationInput;
  let endDate = '';
  if (endType === 'duration') {
    const startObj = parseLocalDate(startDate);
    const endObj = new Date(startObj.getTime() + durationWeeks * 7 * 86400000);
    endDate = formatDateToString(endObj);
  } else {
    endDate = document.getElementById('taskEndDate').value;
    if (endDate < startDate) {
      alert("Task End Date cannot be earlier than Start Date.");
      return;
    }
    const startObj = parseLocalDate(startDate);
    const endObj = parseLocalDate(endDate);
    durationWeeks = Math.ceil((endObj - startObj) / (7 * 86400000)) || 1;
  }
  
  let targetTask = null;
  if (id) {
    // Edit existing task
    targetTask = state.tasks.find(t => t.id === id);
    if (targetTask) {
      const oldProjId = targetTask.projectId;
      if (projectId !== oldProjId) {
        const chainIds = getLinkedTaskChain(targetTask.id);
        chainIds.forEach(cid => {
          const t = state.tasks.find(x => x.id === cid);
          if (t) {
            t.projectId = projectId;
          }
        });
      }
      targetTask.projectId = projectId;
      targetTask.name = name;
      targetTask.startDate = startDate;
      targetTask.startType = startType;
      targetTask.startAfterTaskId = startType === 'dependency' ? startAfterTaskId : null;
      targetTask.endType = endType;
      targetTask.durationWeeks = durationWeeks;
      targetTask.endDate = endDate;
      targetTask.assignee = assignee;
    }
  } else {
    // Create new task
    targetTask = {
      id: 'task-' + Math.random().toString(36).substr(2, 9),
      projectId,
      name,
      startDate,
      startType,
      startAfterTaskId: startType === 'dependency' ? startAfterTaskId : null,
      endType,
      durationWeeks,
      endDate,
      assignee
    };
    state.tasks.push(targetTask);
  }
  
  // Auto-tick the assignees
  const taskAssignees = assignee ? assignee.split(',').map(a => a.trim()).filter(Boolean) : [];
  if (taskAssignees.length === 0) {
    if (!state.ui.filterAssignees.includes('Unassigned')) {
      state.ui.filterAssignees.push('Unassigned');
    }
  } else {
    taskAssignees.forEach(a => {
      if (!state.ui.filterAssignees.includes(a)) {
        state.ui.filterAssignees.push(a);
      }
    });
  }
  
  // Set recurrence flag directly on the task
  targetTask.isIterated = repeatAcrossYears;
  
  // If task is dependent on an iterated task, make it iterated also
  if (startType === 'dependency' && startAfterTaskId) {
    const predecessor = state.tasks.find(t => t.id === startAfterTaskId);
    if (predecessor && predecessor.isIterated) {
      targetTask.isIterated = true;
    }
  }
  
  // Propagate cascading dependencies downstream
  updateTaskDependencies(targetTask.id);
  
  saveState(true);
  closeModal('taskModal');
  syncDropdowns();
  populateSidebarFilters();
  renderGanttChart();
  renderDataTable();
}

function duplicateTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  
  const chainIds = getLinkedTaskChain(id);
  if (chainIds.length > 1) {
    showLinkedActionModal(
      'Duplicate Linked Tasks',
      `The task "${task.name}" is part of a dependency chain. Do you want to duplicate only this task or the entire chain of linked tasks?`,
      false,
      () => {
        // Duplicate single task
        const duplicated = {
          ...task,
          id: 'task-' + Math.random().toString(36).substr(2, 9),
          name: `${task.name} (Copy)`,
          startAfterTaskId: null,
          startType: 'date'
        };
        state.tasks.push(duplicated);
        saveState(true);
        syncDropdowns();
        renderGanttChart();
        renderDataTable();
      },
      () => {
        // Duplicate entire chain
        const idMap = {};
        const newTasks = [];
        chainIds.forEach(cid => {
          const orig = state.tasks.find(t => t.id === cid);
          if (orig) {
            const newId = 'task-' + Math.random().toString(36).substr(2, 9);
            idMap[cid] = newId;
            newTasks.push({
              ...orig,
              id: newId,
              name: `${orig.name} (Copy)`
            });
          }
        });
        newTasks.forEach(nt => {
          if (nt.startType === 'dependency' && nt.startAfterTaskId) {
            const newPredId = idMap[nt.startAfterTaskId];
            if (newPredId) {
              nt.startAfterTaskId = newPredId;
            }
          }
        });
        state.tasks.push(...newTasks);
        saveState(true);
        syncDropdowns();
        renderGanttChart();
        renderDataTable();
      }
    );
  } else {
    // Normal single task duplication
    const duplicated = {
      ...task,
      id: 'task-' + Math.random().toString(36).substr(2, 9),
      name: `${task.name} (Copy)`,
      startAfterTaskId: null,
      startType: 'date'
    };
    state.tasks.push(duplicated);
    saveState(true);
    syncDropdowns();
    renderGanttChart();
    renderDataTable();
  }
}

function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  
  const chainIds = getLinkedTaskChain(id);
  if (chainIds.length > 1) {
    showLinkedActionModal(
      'Delete Linked Tasks',
      `The task "${task.name}" is part of a dependency chain. Do you want to delete only this task or the entire chain of linked tasks?`,
      true,
      () => {
        // Delete single task
        state.tasks.forEach(t => {
          if (t.startAfterTaskId === id) {
            t.startAfterTaskId = null;
            t.startType = 'date';
          }
        });
        state.tasks = state.tasks.filter(t => t.id !== id);
        saveState(true);
        syncDropdowns();
        populateSidebarFilters();
        renderGanttChart();
        renderDataTable();
      },
      () => {
        // Delete entire chain
        state.tasks = state.tasks.filter(t => !chainIds.includes(t.id));
        saveState(true);
        syncDropdowns();
        populateSidebarFilters();
        renderGanttChart();
        renderDataTable();
      }
    );
  } else {
    // Normal delete confirmation
    showConfirmationModal('Delete Task', `Are you sure you want to delete the task "${task.name}"?`, true, () => {
      // Clean up dependent tasks (convert them to manual start date)
      state.tasks.forEach(t => {
        if (t.startAfterTaskId === id) {
          t.startAfterTaskId = null;
          t.startType = 'date';
        }
      });
      state.tasks = state.tasks.filter(t => t.id !== id);
      saveState(true);
      syncDropdowns();
      populateSidebarFilters();
      renderGanttChart();
      renderDataTable();
    });
  }
}

// ==========================================
// CRUD DEADLINE HANDLING
// ==========================================

function addDeadline() {
  document.getElementById('deadlineModalTitle').textContent = 'Add Deadline';
  document.getElementById('deadlineIdField').value = '';
  document.getElementById('deadlineNameInput').value = '';
  
  // Load projects dropdown
  syncDeadlineProjectsDropdown();
  
  // Select first project and set default deadline date
  const projSelect = document.getElementById('deadlineProjectSelect');
  if (projSelect.options.length > 0) {
    projSelect.selectedIndex = 0;
    const pId = projSelect.value;
    if (pId === 'none') {
      document.getElementById('deadlineDateInput').value = formatDateToString(new Date());
    } else {
      const proj = state.projects.find(p => p.id === pId);
      if (proj && proj.endMonth) {
        document.getElementById('deadlineDateInput').value = proj.endMonth + '-01';
      } else {
        document.getElementById('deadlineDateInput').value = formatDateToString(new Date());
      }
    }
  }
  
  // Add onchange handler to auto-suggest date when changing project in Add mode
  projSelect.onchange = () => {
    const pId = projSelect.value;
    if (pId === 'none') {
      document.getElementById('deadlineDateInput').value = formatDateToString(new Date());
    } else {
      const proj = state.projects.find(p => p.id === pId);
      if (proj && proj.endMonth) {
        document.getElementById('deadlineDateInput').value = proj.endMonth + '-01';
      }
    }
  };
  
  openModal('deadlineModal');
}

function editDeadline(id) {
  const deadline = state.deadlines.find(d => d.id === id);
  if (!deadline) return;
  
  document.getElementById('deadlineModalTitle').textContent = 'Edit Deadline';
  document.getElementById('deadlineIdField').value = deadline.id;
  document.getElementById('deadlineNameInput').value = deadline.name;
  document.getElementById('deadlineDateInput').value = deadline.date;
  
  syncDeadlineProjectsDropdown();
  const projSelect = document.getElementById('deadlineProjectSelect');
  projSelect.value = deadline.projectId || 'none';
  projSelect.onchange = null; // Clear onchange listener during edit
  
  openModal('deadlineModal');
}

function handleDeadlineSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('deadlineIdField').value;
  const projectId = document.getElementById('deadlineProjectSelect').value;
  const name = document.getElementById('deadlineNameInput').value.trim();
  const date = document.getElementById('deadlineDateInput').value;
  
  if (id) {
    // Edit
    const dead = state.deadlines.find(d => d.id === id);
    if (dead) {
      dead.projectId = projectId;
      dead.name = name;
      dead.date = date;
    }
  } else {
    // Add
    const newDead = {
      id: 'dead-' + Math.random().toString(36).substr(2, 9),
      projectId,
      name,
      date
    };
    state.deadlines.push(newDead);
  }
  
  saveState(true);
  closeModal('deadlineModal');
  renderGanttChart();
  renderDataTable();
}

function deleteDeadline(id) {
  const dead = state.deadlines.find(d => d.id === id);
  if (!dead) return;
  
  showConfirmationModal('Delete Deadline', `Are you sure you want to delete the deadline "${dead.name}"?`, true, () => {
    state.deadlines = state.deadlines.filter(d => d.id !== id);
    saveState(true);
    renderGanttChart();
    renderDataTable();
  });
}

// ==========================================
// DROPDOWNS POPULATION HELPERS
// ==========================================

function syncDropdowns() {
  // 1. Projects lists on Task modal
  const pSelect = document.getElementById('taskProjectSelect');
  if (pSelect) {
    const val = pSelect.value;
    pSelect.innerHTML = '<option value="none">None (General Tasks)</option>';
    state.projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      pSelect.appendChild(opt);
    });
    pSelect.value = val;
  }
  // 2. Projects lists on Deadline modal
  syncDeadlineProjectsDropdown();
}

// Loads predecessor tasks excluding the active editing task (to prevent circular references)
function syncPredecessorDropdown(excludeTaskId) {
  const pSelect = document.getElementById('taskPredecessorSelect');
  if (!pSelect) return;
  
  const currentVal = pSelect.value;
  pSelect.innerHTML = '';
  
  // Only tasks that are NOT the current task and not recursive descendants of the current task
  const validTasks = state.tasks.filter(t => {
    if (t.id === excludeTaskId) return false;
    
    // Simple cycle check: make sure t doesn't recursively depend on excludeTaskId
    let cursor = t;
    while (cursor && cursor.startAfterTaskId) {
      if (cursor.startAfterTaskId === excludeTaskId) return false;
      cursor = state.tasks.find(p => p.id === cursor.startAfterTaskId);
    }
    return true;
  });
  
  validTasks.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    pSelect.appendChild(opt);
  });
  
  if (pSelect.options.length > 0) {
    pSelect.value = currentVal && validTasks.some(t => t.id === currentVal) ? currentVal : pSelect.options[0].value;
  }
}

function syncDeadlineProjectsDropdown() {
  const select = document.getElementById('deadlineProjectSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="none">None (General Tasks)</option>';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

// ==========================================
// DATA IMPORT / EXPORT & STATE WIPE
// ==========================================

function exportData() {
  const dateStr = formatDateToString(new Date()).replace(/-/g, '');
  const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '').substring(0, 4);
  const now = new Date();
  
  // Filename schema: Antigravity_Gantt_chart_YYYY-MM-DD-HH-mm.json
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const filename = `Antigravity_Gantt_chart_${y}-${m}-${d}-${hh}-${mm}.json`;
  
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  
  // Clean up
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  hasUnexportedChanges = false;
}

function triggerImport() {
  showConfirmationModal(
    'Confirm Overwrite', 
    'Importing data will overwrite your current workspace. Do you wish to continue?', 
    false, 
    () => {
      openModal('importModal');
    }
  );
}

function processImportFile(file) {
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      
      // Basic schema validations
      if (!parsed.projects || !parsed.tasks || !parsed.deadlines) {
        alert("Invalid JSON format. File must contain projects, tasks, and deadlines arrays.");
        return;
      }
      
      state = parsed;
      // Clean UI defaults if they were missing
      if (!state.ui) state.ui = {};
      if (!state.ui.theme) state.ui.theme = 'dark';
      if (!state.ui.zoomMonths) state.ui.zoomMonths = 12;
      if (state.ui.hideListPanel === undefined) state.ui.hideListPanel = false;
      if (state.ui.hideSidebar === undefined) state.ui.hideSidebar = false;
      
      // Force migration/initialization for imported states to tick everything by default
      if (!state.ui.filterProjects || state.ui.filterProjects.length === 0) {
        state.ui.filterProjects = ['none', ...state.projects.map(p => p.id)];
      }
      if (!state.ui.filterAssignees || state.ui.filterAssignees.length === 0) {
        const assignees = new Set();
        let hasUnassigned = false;
        state.tasks.forEach(t => {
          if (t.assignee && t.assignee.trim()) {
            t.assignee.split(',').map(a => a.trim()).filter(Boolean).forEach(a => assignees.add(a));
          } else {
            hasUnassigned = true;
          }
        });
        state.ui.filterAssignees = Array.from(assignees);
        if (hasUnassigned) state.ui.filterAssignees.push('Unassigned');
      }
      
      saveState();
      
      // Reset undo/redo history after a successful importation
      undoStack = [];
      redoStack = [];
      prevDataSnapshot = JSON.stringify({
        projects: state.projects,
        tasks: state.tasks,
        deadlines: state.deadlines
      });
      updateUndoRedoButtons();
      
      hasUnexportedChanges = false;
      
      // Re-initialize app rendering
      applyTheme();
      syncDropdowns();
      populateSidebarFilters();
      initializeTimelineControls();
      renderGanttChart();
      renderDataTable();
      
      // Close the import modal on success
      closeModal('importModal');
      
    } catch(err) {
      alert("Failed to parse JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
}

function handleImportFile(e) {
  const file = e.target.files[0];
  processImportFile(file);
}

function handleResetAll() {
  showConfirmationModal(
    'Reset Workspace',
    'Warning: You are about to permanently delete all projects, tasks, and deadlines. To confirm, please check the box below and click confirm.',
    true,
    () => {
      // Clear data
      state.projects = [];
      state.tasks = [];
      state.deadlines = [];
      state.ui.filterProjects = ['none'];
      state.ui.filterAssignees = [];
      
      const now = new Date();
      state.ui.viewportStartDate = formatDateToString(new Date(now.getFullYear(), now.getMonth(), 1));
      state.ui.zoomMonths = 12;
      
      saveState(true);
      syncDropdowns();
      populateSidebarFilters();
      initializeTimelineControls();
      renderGanttChart();
      renderDataTable();
    },
    true // trigger double confirmation checkbox
  );
}

// ==========================================
// TIMELINE SLIDER HELPERS
// ==========================================

// Convert YYYY-MM string to an integer (months since year 0)
function monthToInt(monthStr) {
  if (!monthStr) return 0;
  const [year, month] = monthStr.split('-').map(Number);
  return year * 12 + (month - 1);
}

// Convert integer back to YYYY-MM string
function intToMonth(n) {
  const year = Math.floor(n / 12);
  const month = (n % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Format a month integer to a human-readable label
function formatMonthIntLabel(n, isLong = false) {
  const year = Math.floor(n / 12);
  const month = n % 12; // 0-indexed
  return new Date(year, month, 1).toLocaleString('en-US', { month: isLong ? 'long' : 'short', year: 'numeric' });
}

// Compute the min/max month integers spanning all data in the current state
function getTimelineDataBounds() {
  let minVal = Infinity;
  let maxVal = -Infinity;

  const consider = (monthStr) => {
    if (!monthStr) return;
    const n = monthToInt(monthStr);
    if (n < minVal) minVal = n;
    if (n > maxVal) maxVal = n;
  };

  state.projects.forEach(p => { consider(p.startMonth); consider(p.endMonth); });
  state.tasks.forEach(t => {
    if (t.startDate) consider(t.startDate.substring(0, 7));
    if (t.endDate)   consider(t.endDate.substring(0, 7));
  });
  state.deadlines.forEach(d => { if (d.date) consider(d.date.substring(0, 7)); });

  if (minVal === Infinity) {
    const now = new Date();
    minVal = now.getFullYear() * 12 + now.getMonth();
    maxVal = minVal + 11;
  }

  return { minVal, maxVal };
}

// Sync the timeline-start slider element with current data bounds and viewport position
function updateTimelineStartSlider() {
  const slider   = document.getElementById('timelineStartSlider');
  const minLabel = document.getElementById('timelineStartMinLabel');
  const maxLabel = document.getElementById('timelineStartMaxLabel');
  const valLabel = document.getElementById('timelineStartValueLabel');
  if (!slider) return;

  const { minVal, maxVal } = getTimelineDataBounds();
  slider.min = minVal;
  slider.max = maxVal;

  let currentVal = minVal;
  if (state.ui.viewportStartDate) {
    const d = parseLocalDate(state.ui.viewportStartDate);
    currentVal = d.getFullYear() * 12 + d.getMonth();
  }
  const clamped = Math.min(Math.max(currentVal, minVal), maxVal);
  slider.value = clamped;

  if (minLabel) minLabel.textContent = formatMonthIntLabel(minVal);
  if (maxLabel) maxLabel.textContent = formatMonthIntLabel(maxVal);
  if (valLabel) valLabel.textContent = formatMonthIntLabel(clamped, true);
}

// ==========================================
// THEME AND VIEWPOT INITIALIZATION
// ==========================================

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.ui.theme);
  const themeToggleText = document.getElementById('themeToggleText');
  const themeIcon = document.getElementById('themeIcon');
  if (themeToggleText && themeIcon) {
    if (state.ui.theme === 'dark') {
      themeToggleText.textContent = 'Lights On';
      themeIcon.innerHTML = `
        <circle cx="12" cy="12" r="5"/>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
      `;
    } else {
      themeToggleText.textContent = 'Lights Off';
      themeIcon.innerHTML = `
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      `;
    }
  }
}

function toggleTheme() {
  state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
  saveState();
  applyTheme();
  renderGanttChart();
}

function toggleListPanel() {
  const listPanel = document.querySelector('.list-panel');
  if (!listPanel) return;
  
  const isCollapsed = listPanel.classList.toggle('collapsed');
  state.ui.hideListPanel = isCollapsed;
  saveState();
  
  const btn = document.getElementById('toggleListPanelBtn');
  if (btn) {
    btn.title = isCollapsed ? 'Expand panel' : 'Collapse panel';
  }
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  
  const isCollapsed = sidebar.classList.toggle('collapsed');
  state.ui.hideSidebar = isCollapsed;
  saveState();
  
  const btn = document.getElementById('toggleSidebarBtn');
  if (btn) {
    btn.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
  }
  
  // Re-fit and render Gantt chart dynamically because the layout changed width!
  renderGanttChart();
}

function toggleFullWindow() {
  const panel = document.querySelector('.visualization-panel');
  const btn = document.getElementById('fullscreenChartBtn');
  if (!panel || !btn) return;

  const isFull = panel.classList.toggle('full-window');
  
  if (isFull) {
    btn.title = 'Restore normal view';
    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.25rem;">
        <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>
      </svg>
      <span>Restore</span>
    `;
  } else {
    btn.title = 'Display chart over the whole window';
    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.25rem;">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
      </svg>
      <span>Full Window</span>
    `;
  }
  
  // Re-render chart to fit the new width immediately
  renderGanttChart();
}

function initializeTimelineControls() {
  const slider    = document.getElementById('timelineStartSlider');
  const valLabel  = document.getElementById('timelineStartValueLabel');
  const zoomSlider = document.getElementById('zoomSlider');
  const zoomText   = document.getElementById('zoomValueText');

  // Ensure a valid viewportStartDate before syncing
  if (!state.ui.viewportStartDate) {
    const { minVal } = getTimelineDataBounds();
    state.ui.viewportStartDate = formatDateToString(new Date(Math.floor(minVal / 12), minVal % 12, 1));
  }

  // Sync slider bounds and current value
  updateTimelineStartSlider();

  if (slider) {
    slider.oninput = () => {
      const val = parseInt(slider.value, 10);
      state.ui.viewportStartDate = formatDateToString(new Date(Math.floor(val / 12), val % 12, 1));
      if (valLabel) valLabel.textContent = formatMonthIntLabel(val, true);
      saveState();
      renderGanttChart();
    };
  }

  if (zoomSlider && zoomText) {
    zoomSlider.value = state.ui.zoomMonths;

    const setZoomLabel = (val) => {
      if (val < 12)            zoomText.textContent = `${val} months`;
      else if (val === 12)     zoomText.textContent = `1 year`;
      else if (val % 12 === 0) zoomText.textContent = `${val / 12} years`;
      else {
        const yrs = Math.floor(val / 12);
        const mths = val % 12;
        zoomText.textContent = `${yrs}y ${mths}m`;
      }
    };

    setZoomLabel(state.ui.zoomMonths);

    zoomSlider.oninput = () => {
      const val = parseInt(zoomSlider.value, 10);
      setZoomLabel(val);
      state.ui.zoomMonths = val;
      saveState();
      renderGanttChart();
    };
  }
}

function resetTimelineView() {
  const now = new Date();
  state.ui.viewportStartDate = formatDateToString(new Date(now.getFullYear(), now.getMonth(), 1));
  state.ui.zoomMonths = 12;

  saveState();

  const zoomSlider = document.getElementById('zoomSlider');
  const zoomText   = document.getElementById('zoomValueText');
  if (zoomSlider) zoomSlider.value = 12;
  if (zoomText)   zoomText.textContent = '1 year';

  updateTimelineStartSlider();
  renderGanttChart();
}

let lastScrollTime = 0;
function scrollTimeline(dir) {
  const now = Date.now();
  if (now - lastScrollTime < 50) return; // throttle to max 20 scrolls per second
  lastScrollTime = now;

  const { viewportStartDate, zoomMonths } = state.ui;
  if (!viewportStartDate) return;
  const timelineStart = parseLocalDate(viewportStartDate);
  const viewportWidth = (document.getElementById('chartViewport') && document.getElementById('chartViewport').clientWidth) || 1000;
  
  const timelineEnd = new Date(timelineStart.getTime());
  timelineEnd.setMonth(timelineEnd.getMonth() + zoomMonths);
  const totalDurationMs = timelineEnd.getTime() - timelineStart.getTime();

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekWidth = (msPerWeek / totalDurationMs) * viewportWidth;
  const monthWidth = viewportWidth / zoomMonths;

  let unit = 'trimester';
  if (weekWidth >= 30) {
    unit = 'week';
  } else if (monthWidth >= 75) {
    unit = 'month';
  }

  const newTimelineStart = new Date(timelineStart.getTime());
  if (unit === 'week') {
    newTimelineStart.setDate(newTimelineStart.getDate() + dir * 7);
  } else if (unit === 'month') {
    newTimelineStart.setMonth(newTimelineStart.getMonth() + dir);
  } else { // trimester
    newTimelineStart.setMonth(newTimelineStart.getMonth() + dir * 3);
  }

  const { minVal, maxVal } = getTimelineDataBounds();
  const scrollMin = minVal - 24;
  const scrollMax = maxVal + 24;
  const newVal = newTimelineStart.getFullYear() * 12 + newTimelineStart.getMonth();
  
  if (newVal >= scrollMin && newVal <= scrollMax) {
    state.ui.viewportStartDate = formatDateToString(newTimelineStart);
    saveState();
    updateTimelineStartSlider();
    renderGanttChart();
  }
}

function formatMonthToString(year, month) {
  const m = String(month + 1).padStart(2, '0');
  return `${year}-${m}`;
}

// ==========================================
// RUN INITIALIZATION ON DOM LOAD
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderLastEdit();
  applyTheme();
  setupProjectFormColorSelector();
  syncDropdowns();
  populateSidebarFilters();
  initializeTimelineControls();
  setupAssigneeAutocomplete();
  updateUndoRedoButtons();
  
  // Initialize list panel collapsed state
  const listPanel = document.querySelector('.list-panel');
  const toggleBtn = document.getElementById('toggleListPanelBtn');
  if (listPanel && state.ui.hideListPanel) {
    listPanel.classList.add('collapsed');
    if (toggleBtn) {
      toggleBtn.title = 'Expand panel';
    }
  }
  if (toggleBtn) {
    toggleBtn.onclick = toggleListPanel;
  }

  // Initialize sidebar collapsed state
  const sidebar = document.querySelector('.sidebar');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  if (sidebar && state.ui.hideSidebar) {
    sidebar.classList.add('collapsed');
    if (toggleSidebarBtn) {
      toggleSidebarBtn.title = 'Expand sidebar';
    }
  }
  if (toggleSidebarBtn) {
    toggleSidebarBtn.onclick = toggleSidebar;
  }
  if (sidebar) {
    sidebar.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'width') {
        renderGanttChart();
      }
    });
  }
  
  // Initial render
  renderGanttChart();
  renderDataTable();
  
  // Wire up button handlers
  document.getElementById('themeToggleBtn').onclick = toggleTheme;
  document.getElementById('importDataBtn').onclick = triggerImport;
  document.getElementById('fileImporter').onchange = handleImportFile;
  document.getElementById('exportDataBtn').onclick = exportData;
  document.getElementById('resetAllBtn').onclick = handleResetAll;
  
  // Wire up dropzone drag and drop handlers
  const dropzone = document.getElementById('importDropzone');
  if (dropzone) {
    dropzone.onclick = () => {
      document.getElementById('fileImporter').click();
    };
    
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      }, false);
    });
    
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        processImportFile(files[0]);
      }
    }, false);
  }
  

  
  document.getElementById('addProjectBtn').onclick = addProject;
  document.getElementById('addTaskBtn').onclick = addTask;
  document.getElementById('addDeadlineBtn').onclick = addDeadline;
  document.getElementById('resetTimelineBtn').onclick = resetTimelineView;
  document.getElementById('undoBtn').onclick = undo;
  document.getElementById('redoBtn').onclick = redo;
  
  const fullscreenBtn = document.getElementById('fullscreenChartBtn');
  if (fullscreenBtn) {
    fullscreenBtn.onclick = toggleFullWindow;
  }

  // Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (isTyping) return; // let form inputs handle their own key events
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      redo();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      scrollTimeline(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      scrollTimeline(1);
    } else if (e.key === 'Escape') {
      const panel = document.querySelector('.visualization-panel');
      if (panel && panel.classList.contains('full-window')) {
        e.preventDefault();
        toggleFullWindow();
      }
    }
  });

  // Sidescroll wheel & Shift+scroll horizontal scroll handler on the Gantt viewport
  const chartViewport = document.getElementById('chartViewport');
  let accumulatedDeltaX = 0;
  const DELTA_THRESHOLD = 50;
  if (chartViewport) {
    chartViewport.addEventListener('wheel', (e) => {
      const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if (Math.abs(dx) > 0.5) {
        e.preventDefault();
        if ((dx > 0 && accumulatedDeltaX < 0) || (dx < 0 && accumulatedDeltaX > 0)) {
          accumulatedDeltaX = 0;
        }
        accumulatedDeltaX += dx;
        if (Math.abs(accumulatedDeltaX) >= DELTA_THRESHOLD) {
          const dir = accumulatedDeltaX > 0 ? 1 : -1;
          scrollTimeline(dir);
          accumulatedDeltaX = 0;
        }
      }
    }, { passive: false });
  }

  // Re-fit and render Gantt chart dynamically when window width changes
  window.addEventListener('resize', () => {
    renderGanttChart();
  });
});

// Warn user on page close if there are unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasUnexportedChanges) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});
