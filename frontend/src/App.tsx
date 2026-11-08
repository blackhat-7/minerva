import { lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import Home from './Home'

const LessonPage = lazy(() => import('./LessonPage'))
const Review = lazy(() => import('./Review'))
const Drill = lazy(() => import('./Drill'))
const Settings = lazy(() => import('./Settings'))
const Gallery = lazy(() => import('./widgets/Gallery'))

export default function App() {
  return (
    <Suspense>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/lesson/:id">{({ id }) => <LessonPage key={id} id={id} />}</Route>
        <Route path="/review" component={Review} />
        <Route path="/drill" component={Drill} />
        <Route path="/settings" component={Settings} />
        <Route path="/gallery" component={Gallery} />
        <Route>
          <div className="p-6 text-muted">Not found.</div>
        </Route>
      </Switch>
    </Suspense>
  )
}
