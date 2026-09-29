import { SUPPORTED_ACTIVITIES } from '../../../lib/projects.mjs';
import ProjectForm from './project-form';

export const metadata = { title: 'New project · Provo' };
export default function NewProjectPage() {
  return <main className="evidence"><p className="eyebrow">PROVO / PROJECT SETUP</p><h1>Start a new project.</h1><p>Set the campaign context for your evidence. Choose the activities your team will document, then add sites on the project dashboard.</p><ProjectForm activities={SUPPORTED_ACTIVITIES} /></main>;
}
